import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, unlink, lstat, rm, readdir } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { createGzip } from 'node:zlib'
import { z } from 'zod'
import type { BackupSource, EngineContext, Snapshot, ByteStream } from './types'
import { indexSchema, manifestSchema, chunkSchema, type BackupIndex, type Manifest, type Chunk } from './schemas'
import { atomicStream, privateDirectory, privateFile, syncDirectory, readBoundedFile, digestFile, contained } from './artifacts'
import { encryptBytes, decryptBytes, encryptStream, generateX25519Identity, identityToRecipient, recipientFingerprint, identitiesFromFile } from './crypto'
import { bytes, transform } from './streams'
import { classifyBoundary } from './snapshot'
import { Journal } from './journal'
import { acquireBackupLock } from './lock'
import { partialBackupDigest } from './partial-trust'
import { BackupError, checkAbort, shellQuote } from './errors'

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
  jobs?: number
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
  trustedPartialSha256?: string
  resumeCommand?: (backupId: string, partialDigest?: string) => string
  publishDirectory?: (source: string, destination: string) => Promise<void>
}
export type BackupResult = { backupId: string; artifactPath: string; manifestSha256: string; consistency: BackupIndex['consistency']; sourceIdentityDigest: string; encryption: 'age-v1' | 'none' }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function removeIfExists(path: string) { await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error }) }
export async function createBackup(options: CreateBackupOptions): Promise<BackupResult> {
  checkAbort(options.signal)
  const jobs = options.jobs ?? 2
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8) throw new BackupError('BACKUP_INVALID_RESOURCE_OPTION', 2)
  if (options.noEncryption && (options.requireEncryption || !options.confirmUnencrypted)) throw new BackupError('BACKUP_UNENCRYPTED_REFUSED', 3)
  if (!options.noEncryption && !options.recipients.length) throw new BackupError('BACKUP_RECIPIENTS_REQUIRED', 3)
  if (!isAbsolute(options.output) || !isAbsolute(options.workspace)) throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED', 2)
  const chunkSizeBytes = options.chunkSizeBytes ?? 64 * 1024 * 1024
  if (chunkSizeBytes < 8 * 1024 * 1024 || chunkSizeBytes > 1024 * 1024 * 1024) throw new BackupError('BACKUP_CHUNK_SIZE_INVALID', 2)
  await privateDirectory(options.output, true)
  await privateDirectory(options.workspace, true)
  const backupId = options.resume ? z.string().uuid().parse(options.resume) : randomUUID()
  let partial = join(options.output, `.${backupId}.partial`)
  let alreadyPublished = false
  if (options.resume && !await lstat(partial).catch(() => null)) {
    const published = join(options.output, backupId)
    await privateDirectory(published)
    if (!await lstat(join(published, 'seal.age')).catch(() => null)) throw new BackupError('BACKUP_ALREADY_COMPLETE', 3)
    partial = published
    alreadyPublished = true
  }
  const runKeyPath = join(options.workspace, `${backupId}.identity`)
  let runIdentity: string
  if (options.resume) {
    await privateDirectory(partial)
    try { await privateFile(runKeyPath); runIdentity = (await readFile(runKeyPath, 'utf8')).trim() }
    catch {
      if (!options.identities?.length) throw new BackupError('BACKUP_RUN_KEY_REQUIRED', 3)
      if (!options.trustedPartialSha256 || options.trustedPartialSha256 !== await partialBackupDigest(partial)) throw new BackupError('BACKUP_TRUSTED_PARTIAL_DIGEST_REQUIRED', 3)
      runIdentity = (await decryptBytes(await readBoundedFile(join(partial, 'run-key.age'), 65536), options.identities, 4096)).toString()
      await atomicStream(runKeyPath, bytes(Buffer.from(runIdentity)))
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
    const finishSealed = async (manifest: Manifest, index: BackupIndex, expectedDigest: string, verify: boolean): Promise<BackupResult> => {
      if (manifest.backupId !== backupId || index.backupId !== backupId) throw new BackupError('BACKUP_SEAL_BINDING_MISMATCH', 4)
      if (verify) {
        const indexDigest = await digestFile(await contained(partial, manifest.index.path), options.signal)
        if (indexDigest.sha256 !== manifest.index.sha256 || String(indexDigest.bytes) !== manifest.index.sizeBytes) throw new BackupError('BACKUP_SEAL_INTEGRITY_FAILED', 4)
        for (const chunk of index.chunks) {
          const actual = await digestFile(await contained(partial, chunk.path), options.signal)
          if (actual.sha256 !== chunk.sha256 || String(actual.bytes) !== chunk.cipherBytes) throw new BackupError('BACKUP_SEAL_INTEGRITY_FAILED', 4)
        }
        const manifestPath = join(partial, 'manifest.json')
        if (await lstat(manifestPath).catch(() => null)) {
          if ((await digestFile(manifestPath)).sha256 !== expectedDigest) throw new BackupError('BACKUP_SEAL_INTEGRITY_FAILED', 4)
        } else await atomicStream(manifestPath, bytes(Buffer.from(JSON.stringify(manifest))))
      }
      const finalPath = join(options.output, backupId)
      if (!alreadyPublished) {
      try { await mkdir(finalPath, { mode: 0o700 }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await privateDirectory(finalPath)
        if ((await readdir(finalPath)).length) throw new BackupError('BACKUP_PUBLICATION_COLLISION', 3)
      }
      await (options.publishDirectory ?? rename)(partial, finalPath)
      }
      await syncDirectory(options.output)
      await release()
      for (const file of ['prepare.age', 'journal.jsonl', 'run-key.age', 'seal.age', 'lock']) await removeIfExists(join(finalPath, file))
      await syncDirectory(finalPath)
      await removeIfExists(runKeyPath)
      return { backupId, artifactPath: finalPath, manifestSha256: expectedDigest, consistency: index.consistency, sourceIdentityDigest: manifest.sourceIdentityDigest, encryption: manifest.encryption.mode }
    }
    if (options.resume && await lstat(join(partial, 'seal.age')).catch(() => null)) {
      const sealedSchema = z.object({ manifest: manifestSchema, index: indexSchema, manifestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
      const sealed = sealedSchema.parse(JSON.parse((await decryptBytes(await readBoundedFile(join(partial, 'seal.age'), maximumIndexBytes + 2 * 1024 * 1024), [runIdentity], maximumIndexBytes + 1024 * 1024)).toString()))
      if (hash(JSON.stringify(sealed.manifest)) !== sealed.manifestSha256) throw new BackupError('BACKUP_SEAL_INTEGRITY_FAILED', 4)
      if (sealed.manifest.encryption.mode !== (options.noEncryption ? 'none' : 'age-v1') || sealed.manifest.encryption.mode === 'age-v1' && sealed.manifest.encryption.recipientSetFingerprint !== recipientFingerprint(options.recipients) || options.quiesced && sealed.index.consistency !== 'quiesced') throw new BackupError('BACKUP_RESUME_BINDING_MISMATCH', 3)
      return await finishSealed(sealed.manifest, sealed.index, sealed.manifestSha256, true)
    }
    const completed = new Set<string>()
    let settings: z.infer<typeof settingsSchema>
    if (options.resume) {
      settings = settingsSchema.parse(JSON.parse((await decryptBytes(await readBoundedFile(join(partial, 'prepare.age'), maximumIndexBytes + 65536), [runIdentity], maximumIndexBytes)).toString()))
      if (settings.backupId !== backupId || settings.index.backupId !== backupId) throw new BackupError('BACKUP_RESUME_BINDING_MISMATCH', 3)
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
        schemaVersion: 1, backupId, identity: snapshot.identity, migrationFingerprint: snapshot.migrationFingerprint, entities: snapshot.entities, chunks: [], catalogDigest: snapshot.catalogDigest,
        evidence: snapshot.evidence, epochs: 1, consistency: options.quiesced ? 'quiesced' : 'single-snapshot', sequences: [], foreignKeys: snapshot.foreignKeys,
      } }
      settings = settingsSchema.parse(settings)
      if (options.quiesced && snapshot.evidence.xipList.length) throw new BackupError('BACKUP_QUIESCENCE_NOT_PROVEN', 3)
      await atomicStream(join(partial, 'prepare.age'), bytes(await encryptBytes(Buffer.from(JSON.stringify(settings)), [runRecipient])))
      stateReady = true
      if (options.recipients.length) await atomicStream(join(partial, 'run-key.age'), bytes(await encryptBytes(Buffer.from(runIdentity), options.recipients)))

    }
    if (!snapshot) {
      snapshot = await options.source.open()
      if (options.labels) snapshot.entities = snapshot.entities.map((entity) => ({ ...entity, label: options.labels?.[`${entity.schema}.${entity.table}`] ?? entity.label }))
      if (settings.index.identity.clusterIncarnation !== snapshot.identity.clusterIncarnation || settings.index.identity.databaseOid !== snapshot.identity.databaseOid) throw new BackupError('BACKUP_RESUME_DATABASE_MISMATCH', 3)
      const consistency = classifyBoundary(settings.index, snapshot, settings.index.consistency)
      if (options.quiesced && consistency !== 'quiesced') throw new BackupError('BACKUP_QUIESCENCE_NOT_PROVEN', 3)
      const oldChunks = settings.index.chunks
      const reset = snapshot.catalogDigest !== settings.index.catalogDigest
      const newIndex: BackupIndex = { ...settings.index, entities: snapshot.entities, identity: snapshot.identity, migrationFingerprint: snapshot.migrationFingerprint, foreignKeys: snapshot.foreignKeys, evidence: snapshot.evidence, catalogDigest: snapshot.catalogDigest, epochs: settings.index.epochs + 1, consistency, chunks: [] }
      await journal.append({ kind: 'epoch', index: newIndex, reset })
      newIndex.chunks = reset ? [] : settings.index.chunks
      settings.index = newIndex
      if (reset) {
        completed.clear()
        for (const chunk of oldChunks) await removeIfExists(await contained(partial, chunk.path))
      }
    }
    const index = settings.index
    let indexBudget = Buffer.byteLength(JSON.stringify(index))
    let cipherBytes = index.chunks.reduce((sum, chunk) => sum + Number(chunk.cipherBytes), 0)
    let allocatedOutputBytes = cipherBytes
    const entityRows=new Map<string,bigint>()
    let overallRows=0n
    const estimatedRows=snapshot.entities.reduce((sum,entity)=>sum+BigInt(entity.estimatedRows),0n)
    const aggregate=(entityKey?:string,rows='0',finished=false)=>{
      if(entityKey){const count=BigInt(rows);overallRows+=count-(entityRows.get(entityKey)??0n);entityRows.set(entityKey,count)}
      return {overallRowsDone:String(overallRows),overallRowsTotal:String(finished?overallRows:estimatedRows),overallRowsTotalExact:finished}
    }
    const emit = (type: 'run.started' | 'entity.done' | 'phase.changed' | 'run.finished', entity?: string, rows = '0', entityKey?:string) => options.progress?.({ schemaVersion: 1, type, runId: backupId, entity, ...aggregate(entityKey,rows,type==='run.finished'), rowsDone: rows, rowsTotal: rows, rowsTotalExact: type === 'entity.done', phase: settings.encryption ? 'encrypted' : 'UNENCRYPTED', bytesDone: String(cipherBytes), chunksDone: index.chunks.length, at: new Date().toISOString() })
    emit('run.started')
    await mkdir(join(partial, 'schema'), { mode: 0o700, recursive: true })
    await mkdir(join(partial, 'data'), { mode: 0o700, recursive: true })
    const write = async (path: string, stream: ByteStream, extra: Pick<Chunk, 'sequence' | 'rows'> & Partial<Chunk>) => {
      checkAbort(options.signal)
      let plainBytes = 0
      async function* counted() { for await (const chunk of stream) { plainBytes += chunk.byteLength; yield chunk } }
      const compressed = transform(counted(), createGzip({ chunkSize: 1024 * 1024 }))
      const encoded = settings.encryption ? await encryptStream(compressed, settings.recipients) : compressed
      const destination = join(partial, path)
      await removeIfExists(destination)
      let reservation = 0
      async function* budgeted() {
        for await (const block of encoded) {
          if (options.maxOutputBytes !== undefined && allocatedOutputBytes + block.byteLength > options.maxOutputBytes) throw new BackupError('BACKUP_OUTPUT_LIMIT', 5, true)
          allocatedOutputBytes += block.byteLength
          reservation += block.byteLength
          yield block
        }
      }
      try {
      const record = await atomicStream(destination, budgeted(), { signal: options.signal, reserveBytes: options.reserveBytes ?? 1024n * 1024n * 1024n })
      const chunk: Chunk = { path, ...extra, plainBytes: String(plainBytes), cipherBytes: String(record.bytes), sha256: record.sha256, epoch: index.epochs - 1 }
      await journal.append({ kind: 'chunk', chunk })
      index.chunks.push(chunk)
      cipherBytes += record.bytes
      indexBudget += Buffer.byteLength(JSON.stringify(chunk)) + 1
      if (index.chunks.length > 1000000 || indexBudget > maximumIndexBytes) throw new BackupError('BACKUP_INDEX_LIMIT', 5, true)
      return chunk
      } catch (error) {
        allocatedOutputBytes -= reservation
        await removeIfExists(destination)
        throw error
      }
    }
    for (const section of ['pre-data', 'post-data'] as const) {
      if (!index.chunks.some((chunk) => chunk.section === section)) await write(`schema/${section}.chunk`, snapshot.schema(section), { sequence: 0, rows: '0', section })
    }
    let poolFailure: unknown
    let cursor = 0
    const processEntity = async (entity: Snapshot['entities'][number]) => {
      if (completed.has(entity.key)) { emit('entity.done', entity.label,String(index.chunks.filter(chunk=>chunk.entityKey===entity.key).reduce((sum,chunk)=>sum+BigInt(chunk.rows),0n)),entity.key); return }
      const previous = index.chunks.filter((chunk) => chunk.entityKey === entity.key)
      if (previous.length) {
        await journal.append({ kind: 'restart', entityKey: entity.key })
        index.chunks = index.chunks.filter((chunk) => chunk.entityKey !== entity.key)
        for (const chunk of previous) await removeIfExists(await contained(partial, chunk.path))
        const removedBytes = previous.reduce((sum, chunk) => sum + Number(chunk.cipherBytes), 0)
        cipherBytes -= removedBytes
        allocatedOutputBytes -= removedBytes
        indexBudget = Buffer.byteLength(JSON.stringify(index))
      }
      await mkdir(join(partial, 'data', entity.key), { recursive: true, mode: 0o700 })
      let rows = 0n
      let entityBytes = 0n
      for await (const chunk of snapshot!.chunks(entity, { chunkSizeBytes })) {
        if (poolFailure) throw poolFailure
        const written = await write(`data/${entity.key}/${chunk.sequence}.chunk`, chunk.stream, { sequence: chunk.sequence, rows: chunk.rows, entityKey: entity.key, keyFrom: chunk.keyFrom, keyTo: chunk.keyTo })
        rows += BigInt(chunk.rows)
        entityBytes += BigInt(written.plainBytes)
        options.progress?.({ schemaVersion: 1, type: 'entity.progress', runId: backupId, entity: entity.label, ...aggregate(entity.key,String(rows)), rowsDone: String(rows), rowsTotal: entity.estimatedRows, rowsTotalExact: false, bytesDone: String(entityBytes), chunksDone: chunk.sequence + 1, at: new Date().toISOString() })
      }
      await journal.append({ kind: 'entity-complete', entityKey: entity.key })
      emit('entity.done', entity.label, String(rows),entity.key)
    }
    await Promise.all(Array.from({ length: Math.min(jobs, Math.max(1, index.entities.length)) }, async () => {
      while (cursor < index.entities.length && !poolFailure) {
        const entity = index.entities[cursor++]
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await processEntity(entity); break } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
            const connectionMessage = error instanceof Error && ['Client has encountered a connection error and is not queryable', 'Connection terminated unexpectedly'].includes(error.message)
            const transient = connectionMessage || ['BACKUP_COPY_READ_FAILED', 'BACKUP_CONNECTION_FAILED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03'].includes(code) || /^08[A-Z0-9]{3}$/.test(code)
            if (!transient || attempt === 2 || options.signal?.aborted || poolFailure) { poolFailure = error; break }
          }
        }
      }
    }))
    if (poolFailure) throw poolFailure
    if (options.quiesced) {
      const boundary = await snapshot.boundary()
      if (classifyBoundary(snapshot, boundary, 'single-snapshot') !== 'quiesced') throw new BackupError('BACKUP_QUIESCENCE_NOT_PROVEN', 3)
    }
    index.sequences = await snapshot.sequences()
    const validatedIndex = indexSchema.parse(index)
    const plainIndex = Buffer.from(JSON.stringify(validatedIndex))
    if (plainIndex.length > maximumIndexBytes) throw new BackupError('BACKUP_INDEX_LIMIT', 5, true)
    const indexPath = settings.encryption ? 'index.age' : 'index.json'
    await removeIfExists(join(partial, indexPath))
    const encodedIndex = settings.encryption ? await encryptBytes(plainIndex, settings.recipients) : plainIndex
    if (options.maxOutputBytes !== undefined && allocatedOutputBytes + encodedIndex.byteLength > options.maxOutputBytes) throw new BackupError('BACKUP_OUTPUT_LIMIT',5,true)
    const indexRecord = await atomicStream(join(partial, indexPath), bytes(encodedIndex))
    const sourceIdentityDigest = hash(JSON.stringify(validatedIndex.identity))
    const manifest: Manifest = manifestSchema.parse({ schemaVersion: 1, state: 'complete', backupId, startedAt: settings.startedAt, completedAt: new Date().toISOString(), kind: 'postgresql-logical-chunked', scope: 'whole-database', encryption: { mode: settings.encryption ? 'age-v1' : 'none', recipientSetFingerprint: settings.encryption ? recipientFingerprint(settings.recipients) : undefined }, compression: 'gzip', consistency: { mode: index.consistency, epochs: index.epochs }, sourceIdentityDigest, serverMajor: index.identity.serverMajor, encoding: index.identity.encoding, collation: index.identity.collation, index: { path: indexPath, sizeBytes: String(indexRecord.bytes), sha256: indexRecord.sha256 }, chunkCount: index.chunks.length, totalCipherBytes: String(cipherBytes), exclusions: ['external-files', 'object-stores', 'vault', 'redis', 'cluster-globals', 'wal'] })
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    if (options.maxOutputBytes !== undefined && allocatedOutputBytes + indexRecord.bytes + manifestBytes.byteLength > options.maxOutputBytes) throw new BackupError('BACKUP_OUTPUT_LIMIT',5,true)
    await removeIfExists(join(partial, 'seal.age'))
    await atomicStream(join(partial, 'seal.age'), bytes(await encryptBytes(Buffer.from(JSON.stringify({ manifest, index: validatedIndex, manifestSha256: hash(manifestBytes.toString()) })), [runRecipient])))
    await removeIfExists(join(partial, 'manifest.json'))
    const manifestRecord = await atomicStream(join(partial, 'manifest.json'), bytes(manifestBytes))
    await snapshot.close(); snapshot = undefined
    const result = await finishSealed(manifest, index, manifestRecord.sha256, false)
    emit('run.finished')
    return result
  } catch (error) {
    if (!stateReady) {
      await removeIfExists(runKeyPath)
      await rm(partial, { recursive: true, force: true })
    }
    const failure = error instanceof BackupError ? error : new BackupError('BACKUP_CREATE_FAILED', 5, stateReady)
    if (stateReady && failure.resumable) failure.context = { backupId, partialStateSha256: await partialBackupDigest(partial).catch(() => undefined), resumeCommand: options.resumeCommand?.(backupId, await partialBackupDigest(partial).catch(() => undefined)) ?? `mercato-backup create --resume ${backupId} --output ${shellQuote(options.output)} --workspace ${shellQuote(options.workspace)} --source-service <same-service> --recipients-file <same-recipients-file>` }
    throw failure
  } finally {
    await snapshot?.close().catch(() => undefined)
    await options.source.close().catch(() => undefined)
    await release().catch(() => undefined)
  }
}
