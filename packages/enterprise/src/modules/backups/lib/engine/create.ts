import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, unlink, lstat, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { createGzip } from 'node:zlib'
import { z } from 'zod'
import type { BackupSource, EngineContext, Snapshot, ByteStream } from './types'
import { indexSchema, manifestSchema, chunkSchema, type BackupIndex, type Manifest, type Chunk } from './schemas'
import { atomicStream, privateDirectory, privateFile, syncDirectory, readBoundedFile } from './artifacts'
import { encryptBytes, decryptBytes, encryptStream, generateX25519Identity, identityToRecipient, recipientFingerprint, identitiesFromFile } from './crypto'
import { bytes, transform } from './streams'
import { classifyBoundary } from './snapshot'
import { Journal } from './journal'
import { acquireBackupLock } from './lock'
import { BackupError, checkAbort } from './errors'

const maximumIndexBytes = 64 * 1024 * 1024
const settingsSchema = z.object({ backupId: z.string().uuid(), startedAt: z.string(), recipients: z.array(z.string()), encryption: z.boolean(), chunkSizeBytes: z.number(), index: indexSchema }).strict()
const journalEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chunk'), chunk: chunkSchema }).strict(),
  z.object({ kind: z.literal('entity-complete'), entityKey: z.string() }).strict(),
  z.object({ kind: z.literal('restart'), entityKey: z.string() }).strict(),
  z.object({ kind: z.literal('epoch'), index: indexSchema, reset: z.boolean() }).strict(),
])
export type CreateBackupOptions = EngineContext & {
  source: BackupSource
  output: string
  workspace: string
  recipients: string[]
  labels?: Record<string, string>
  noEncryption?: boolean
  confirmUnencrypted?: boolean
  requireEncryption?: boolean
  chunkSizeBytes?: number
  maxOutputBytes?: number
  reserveBytes?: bigint
  quiesced?: boolean
  resume?: string
  identities?: string[]
  takeOverLock?: string
}
export type BackupResult = { backupId: string; artifactPath: string; manifestSha256: string; consistency: BackupIndex['consistency']; sourceIdentityDigest: string; encryption: 'age-v1' | 'none' }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function removeIfExists(path: string) { await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error }) }
export async function createBackup(options: CreateBackupOptions): Promise<BackupResult> {
  checkAbort(options.signal)
  if (options.noEncryption && (options.requireEncryption || !options.confirmUnencrypted)) throw new BackupError('BACKUP_UNENCRYPTED_REFUSED', 3)
  if (!options.noEncryption && !options.recipients.length) throw new BackupError('BACKUP_RECIPIENTS_REQUIRED', 3)
  if (!isAbsolute(options.output) || !isAbsolute(options.workspace)) throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED', 2)
  const chunkSizeBytes = options.chunkSizeBytes ?? 64 * 1024 * 1024
  if (chunkSizeBytes < 8 * 1024 * 1024 || chunkSizeBytes > 1024 * 1024 * 1024) throw new BackupError('BACKUP_CHUNK_SIZE_INVALID', 2)
  await privateDirectory(options.output, true)
  await privateDirectory(options.workspace, true)
  const backupId = options.resume ? z.string().uuid().parse(options.resume) : randomUUID()
  const partial = join(options.output, `.${backupId}.partial`)
  const runKeyPath = join(options.workspace, `${backupId}.identity`)
  let runIdentity: string
  if (options.resume) {
    await privateDirectory(partial)
    if (await lstat(join(partial, 'manifest.json')).catch(() => null)) throw new BackupError('BACKUP_ALREADY_SEALED_PARTIAL', 3)
    try { await privateFile(runKeyPath); runIdentity = (await readFile(runKeyPath, 'utf8')).trim() }
    catch {
      if (!options.identities?.length) throw new BackupError('BACKUP_RUN_KEY_REQUIRED', 3)
      runIdentity = (await decryptBytes(await readBoundedFile(join(partial, 'run-key.age'), 65536), options.identities, 4096)).toString()
    }
  } else {
    await mkdir(partial, { mode: 0o700 })
    runIdentity = await generateX25519Identity()
    await atomicStream(runKeyPath, bytes(Buffer.from(runIdentity)))
  }
  const runRecipient = await identityToRecipient(runIdentity)
  const release = await acquireBackupLock(join(partial, 'lock'), randomUUID(), options.takeOverLock)
  let snapshot: Snapshot | undefined
  let stateReady = Boolean(options.resume)
  try {
    const journal = new Journal(join(partial, 'journal.jsonl'), runRecipient, runIdentity)
    const completed = new Set<string>()
    let settings: z.infer<typeof settingsSchema>
    if (options.resume) {
      settings = settingsSchema.parse(JSON.parse((await decryptBytes(await readBoundedFile(join(partial, 'prepare.age'), maximumIndexBytes + 65536), [runIdentity], maximumIndexBytes)).toString()))
      if (settings.encryption !== !options.noEncryption || recipientFingerprint(settings.recipients) !== recipientFingerprint(options.recipients) || settings.chunkSizeBytes !== chunkSizeBytes) throw new BackupError('BACKUP_RESUME_BINDING_MISMATCH', 3)
      for await (const record of journal.entries()) {
        const event = journalEvent.parse(record)
        if (event.kind === 'chunk') settings.index.chunks.push(event.chunk)
        if (event.kind === 'entity-complete') completed.add(event.entityKey)
        if (event.kind === 'restart') { settings.index.chunks = settings.index.chunks.filter((chunk) => chunk.entityKey !== event.entityKey); completed.delete(event.entityKey) }
        if (event.kind === 'epoch') {
          const priorChunks = settings.index.chunks
          settings.index = event.index
          settings.index.chunks = event.reset ? [] : priorChunks
          if (event.reset) completed.clear()
        }
      }
    } else {
      snapshot = await options.source.open()
      if (options.labels) snapshot.entities = snapshot.entities.map((entity) => ({ ...entity, label: options.labels?.[`${entity.schema}.${entity.table}`] ?? entity.label }))
      settings = { backupId, startedAt: new Date().toISOString(), recipients: options.recipients, encryption: !options.noEncryption, chunkSizeBytes, index: {
        schemaVersion: 1, backupId, identity: snapshot.identity, entities: snapshot.entities, chunks: [], catalogDigest: snapshot.catalogDigest,
        evidence: snapshot.evidence, epochs: 1, consistency: options.quiesced ? 'quiesced' : 'single-snapshot', sequences: [], foreignKeys: snapshot.foreignKeys,
      } }
      if (options.quiesced && snapshot.evidence.xipList.length) throw new BackupError('BACKUP_QUIESCENCE_NOT_PROVEN', 3)
      await atomicStream(join(partial, 'prepare.age'), bytes(await encryptBytes(Buffer.from(JSON.stringify(settings)), [runRecipient])))
      stateReady = true
      if (options.recipients.length) await atomicStream(join(partial, 'run-key.age'), bytes(await encryptBytes(Buffer.from(runIdentity), options.recipients)))

    }
    if (!snapshot) {
      snapshot = await options.source.open()
      if (options.labels) snapshot.entities = snapshot.entities.map((entity) => ({ ...entity, label: options.labels?.[`${entity.schema}.${entity.table}`] ?? entity.label }))
      const consistency = classifyBoundary(settings.index, snapshot, settings.index.consistency)
      if (options.quiesced && consistency !== 'quiesced') throw new BackupError('BACKUP_QUIESCENCE_NOT_PROVEN', 3)
      const reset = snapshot.catalogDigest !== settings.index.catalogDigest
      const newIndex: BackupIndex = { ...settings.index, entities: snapshot.entities, identity: snapshot.identity, foreignKeys: snapshot.foreignKeys, evidence: snapshot.evidence, catalogDigest: snapshot.catalogDigest, epochs: settings.index.epochs + 1, consistency, chunks: [] }
      await journal.append({ kind: 'epoch', index: newIndex, reset })
      newIndex.chunks = reset ? [] : settings.index.chunks
      settings.index = newIndex
      if (reset) completed.clear()
    }
    const index = settings.index
    let indexBudget = Buffer.byteLength(JSON.stringify(index))
    let cipherBytes = index.chunks.reduce((sum, chunk) => sum + Number(chunk.cipherBytes), 0)
    const emit = (type: 'run.started' | 'entity.done' | 'phase.changed' | 'run.finished', entity?: string, rows = '0') => options.progress?.({ schemaVersion: 1, type, runId: backupId, entity, rowsDone: rows, rowsTotal: rows, rowsTotalExact: type === 'entity.done', bytesDone: String(cipherBytes), chunksDone: index.chunks.length, at: new Date().toISOString() })
    emit('run.started')
    await mkdir(join(partial, 'schema'), { mode: 0o700, recursive: true })
    await mkdir(join(partial, 'data'), { mode: 0o700, recursive: true })
    const write = async (path: string, stream: ByteStream, extra: Pick<Chunk, 'sequence' | 'rows'> & Partial<Chunk>) => {
      checkAbort(options.signal)
      let plainBytes = 0
      async function* counted() { for await (const chunk of stream) { plainBytes += chunk.byteLength; yield chunk } }
      const compressed = transform(counted(), createGzip())
      const encoded = settings.encryption ? await encryptStream(compressed, settings.recipients) : compressed
      const destination = join(partial, path)
      await removeIfExists(destination)
      const record = await atomicStream(destination, encoded, { signal: options.signal, reserveBytes: options.reserveBytes ?? 1024n * 1024n * 1024n, maxBytes: options.maxOutputBytes === undefined ? undefined : options.maxOutputBytes - cipherBytes })
      const chunk: Chunk = { path, ...extra, plainBytes: String(plainBytes), cipherBytes: String(record.bytes), sha256: record.sha256, epoch: index.epochs - 1 }
      await journal.append({ kind: 'chunk', chunk })
      index.chunks.push(chunk)
      cipherBytes += record.bytes
      indexBudget += Buffer.byteLength(JSON.stringify(chunk)) + 1
      if (index.chunks.length > 1000000 || indexBudget > maximumIndexBytes) throw new BackupError('BACKUP_INDEX_LIMIT', 5, true)
    }
    for (const section of ['pre-data', 'post-data'] as const) {
      if (!index.chunks.some((chunk) => chunk.section === section)) await write(`schema/${section}.chunk`, snapshot.schema(section), { sequence: 0, rows: '0', section })
    }
    for (const entity of index.entities) {
      if (completed.has(entity.key)) { emit('entity.done', entity.label); continue }
      const previous = index.chunks.filter((chunk) => chunk.entityKey === entity.key)
      if (previous.length) {
        await journal.append({ kind: 'restart', entityKey: entity.key })
        index.chunks = index.chunks.filter((chunk) => chunk.entityKey !== entity.key)
      }
      await mkdir(join(partial, 'data', entity.key), { recursive: true, mode: 0o700 })
      let rows = 0n
      for await (const chunk of snapshot.chunks(entity, { chunkSizeBytes })) {
        await write(`data/${entity.key}/${chunk.sequence}.chunk`, chunk.stream, { sequence: chunk.sequence, rows: chunk.rows, entityKey: entity.key, keyFrom: chunk.keyFrom, keyTo: chunk.keyTo })
        rows += BigInt(chunk.rows)
      }
      await journal.append({ kind: 'entity-complete', entityKey: entity.key })
      emit('entity.done', entity.label, String(rows))
    }
    if (options.quiesced) {
      const boundary = await snapshot.boundary()
      if (classifyBoundary(snapshot, boundary, 'single-snapshot') !== 'quiesced') throw new BackupError('BACKUP_QUIESCENCE_NOT_PROVEN', 3)
    }
    index.sequences = await snapshot.sequences()
    const plainIndex = Buffer.from(JSON.stringify(indexSchema.parse(index)))
    if (plainIndex.length > maximumIndexBytes) throw new BackupError('BACKUP_INDEX_LIMIT', 5, true)
    const indexPath = settings.encryption ? 'index.age' : 'index.json'
    await removeIfExists(join(partial, indexPath))
    const indexRecord = await atomicStream(join(partial, indexPath), bytes(settings.encryption ? await encryptBytes(plainIndex, settings.recipients) : plainIndex))
    const sourceIdentityDigest = hash(JSON.stringify(index.identity))
    const manifest: Manifest = manifestSchema.parse({ schemaVersion: 1, state: 'complete', backupId, startedAt: settings.startedAt, completedAt: new Date().toISOString(), kind: 'postgresql-logical-chunked', scope: 'whole-database', encryption: { mode: settings.encryption ? 'age-v1' : 'none', recipientSetFingerprint: settings.encryption ? recipientFingerprint(settings.recipients) : undefined }, compression: 'gzip', consistency: { mode: index.consistency, epochs: index.epochs }, sourceIdentityDigest, serverMajor: index.identity.serverMajor, encoding: index.identity.encoding, collation: index.identity.collation, index: { path: indexPath, sizeBytes: String(indexRecord.bytes), sha256: indexRecord.sha256 }, chunkCount: index.chunks.length, totalCipherBytes: String(cipherBytes), exclusions: ['external-files', 'object-stores', 'vault', 'redis', 'cluster-globals', 'wal'] })
    await removeIfExists(join(partial, 'manifest.json'))
    const manifestRecord = await atomicStream(join(partial, 'manifest.json'), bytes(Buffer.from(JSON.stringify(manifest))))
    await snapshot.close(); snapshot = undefined
    const finalPath = join(options.output, backupId)
    await mkdir(finalPath, { mode: 0o700 })
    await rename(partial, finalPath)
    await syncDirectory(options.output)
    await release()
    for (const file of ['prepare.age', 'journal.jsonl', 'run-key.age', 'lock']) await removeIfExists(join(finalPath, file))
    await syncDirectory(finalPath)
    await removeIfExists(runKeyPath)
    emit('run.finished')
    return { backupId, artifactPath: finalPath, manifestSha256: manifestRecord.sha256, consistency: index.consistency, sourceIdentityDigest, encryption: settings.encryption ? 'age-v1' : 'none' }
  } catch (error) {
    if (!stateReady) {
      await removeIfExists(runKeyPath)
      await rm(partial, { recursive: true, force: true })
    }
    const failure = error instanceof BackupError ? error : new BackupError('BACKUP_CREATE_FAILED', 5, stateReady)
    if (stateReady && failure.resumable) failure.context = { backupId, resumeCommand: `mercato-backup create --resume ${backupId} --output ${JSON.stringify(options.output)} --workspace ${JSON.stringify(options.workspace)} --source-service <same-service> --recipients-file <same-recipients-file>` }
    throw failure
  } finally {
    await snapshot?.close().catch(() => undefined)
    await options.source.close().catch(() => undefined)
    await release().catch(() => undefined)
  }
}
