import { createReadStream } from 'node:fs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { manifestSchema, indexSchema, type Manifest, type BackupIndex, type Chunk } from './schemas'
import type { ByteStream, EngineContext } from './types'
import { privateDirectory, privateFile, contained, digestFile, readBoundedFile } from './artifacts'
import { decryptBytes, decryptStream } from './crypto'
import { transform } from './streams'
import { createPostgresSchemaInspector } from './schema-inspection'
import { BackupError, checkAbort } from './errors'

export type VerifyBackupOptions = EngineContext & { artifact: string; trustedManifestSha256: string; identities?: string[]; workspace?: string; binariesDir?: string; maxStagingBytes?: number; schemaInspector?: (stream: ByteStream, sourceMajor: number) => Promise<void> }
export type VerifiedBackup = { manifest: Manifest; index: BackupIndex }
function equalDigest(actual: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}
async function readBackupInternal(options: VerifyBackupOptions): Promise<VerifiedBackup> {
  await privateDirectory(options.artifact)
  const manifestPath = join(options.artifact, 'manifest.json')
  await privateFile(manifestPath)
  const manifestBytes = await readBoundedFile(manifestPath, 1024 * 1024)
  if (manifestBytes.length > 1024 * 1024 || !equalDigest(createHash('sha256').update(manifestBytes).digest('hex'), options.trustedManifestSha256)) throw new BackupError('BACKUP_MANIFEST_TRUST_FAILED', 4)
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()))
  const indexPath = await contained(options.artifact, manifest.index.path)
  const indexDigest = await digestFile(indexPath, options.signal)
  if (String(indexDigest.bytes) !== manifest.index.sizeBytes || indexDigest.bytes > 65 * 1024 * 1024 || !equalDigest(indexDigest.sha256, manifest.index.sha256)) throw new BackupError('BACKUP_INDEX_INTEGRITY_FAILED', 4)
  const encrypted = await readBoundedFile(indexPath, 65 * 1024 * 1024)
  if (!equalDigest(createHash('sha256').update(encrypted).digest('hex'), manifest.index.sha256)) throw new BackupError('BACKUP_INDEX_INTEGRITY_FAILED', 4)
  const indexBytes = manifest.encryption.mode === 'age-v1' ? await decryptBytes(encrypted, options.identities ?? []) : encrypted
  if (indexBytes.byteLength > 64 * 1024 * 1024) throw new BackupError('BACKUP_INDEX_LIMIT', 4)
  const index = indexSchema.parse(JSON.parse(indexBytes.toString()))
  if (index.backupId !== manifest.backupId || index.chunks.length !== manifest.chunkCount || index.consistency !== manifest.consistency.mode || index.epochs !== manifest.consistency.epochs || createHash('sha256').update(JSON.stringify(index.identity)).digest('hex') !== manifest.sourceIdentityDigest) throw new BackupError('BACKUP_BINDING_MISMATCH', 4)
  const paths = new Set<string>()
  const entities = new Set(index.entities.map((entity) => entity.key))
  if (entities.size !== index.entities.length || index.chunks.some((chunk) => {
    if (paths.has(chunk.path) || (chunk.entityKey && !entities.has(chunk.entityKey))) return true
    paths.add(chunk.path); return false
  })) throw new BackupError('BACKUP_DUPLICATE_CHUNK', 4)
  if (index.chunks.reduce((sum, chunk) => sum + BigInt(chunk.cipherBytes), 0n) !== BigInt(manifest.totalCipherBytes)) throw new BackupError('BACKUP_BINDING_MISMATCH', 4)
  const sections = index.chunks.filter((chunk) => chunk.section)
  if (sections.length !== 2 || !sections.some((chunk) => chunk.section === 'pre-data') || !sections.some((chunk) => chunk.section === 'post-data') || sections.some((chunk) => chunk.entityKey)) throw new BackupError('BACKUP_SCHEMA_CHUNKS_REQUIRED',4)
  return { manifest, index }
}
export async function readBackup(options: VerifyBackupOptions): Promise<VerifiedBackup> {
  try { return await readBackupInternal(options) }
  catch (error) { if (error instanceof BackupError) throw error; throw new BackupError('BACKUP_ARTIFACT_INTEGRITY_FAILED', 4) }
}
export async function* authenticatedChunk(options: VerifyBackupOptions, manifest: Manifest, chunk: Chunk): ByteStream {
  const path = await contained(options.artifact, chunk.path)
  await privateFile(path)
  const hash = createHash('sha256')
  let cipherBytes = 0n
  async function* input() {
    for await (const block of createReadStream(path, { highWaterMark: 256 * 1024 })) {
      checkAbort(options.signal)
      cipherBytes += BigInt(block.byteLength)
      if (cipherBytes > BigInt(chunk.cipherBytes)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
      hash.update(block)
      yield block
    }
  }
  try {
    const decoded = manifest.encryption.mode === 'age-v1' ? await decryptStream(input(), options.identities ?? []) : input()
    yield* decoded
    if (cipherBytes !== BigInt(chunk.cipherBytes) || !equalDigest(hash.digest('hex'), chunk.sha256)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('BACKUP_CHUNK_AUTHENTICATION_FAILED', 4)
  }
}
export async function* verifiedChunk(options: VerifyBackupOptions, manifest: Manifest, chunk: Chunk): ByteStream {
  let plainBytes = 0n
  try {
    for await (const block of transform(authenticatedChunk(options, manifest, chunk), createGunzip({ chunkSize: 256 * 1024 }))) {
      plainBytes += BigInt(block.byteLength)
      if (plainBytes > BigInt(chunk.plainBytes)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
      yield block
    }
    if (plainBytes !== BigInt(chunk.plainBytes)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('BACKUP_CHUNK_AUTHENTICATION_FAILED', 4)
  }
}
export async function verifyBackupChunks(options: VerifyBackupOptions, artifact: VerifiedBackup, chunks: Chunk[]): Promise<void> {
  const ownWorkspace = !options.schemaInspector && !options.workspace ? await mkdtemp(join(tmpdir(),'om-backup-verify-')) : undefined
  const inspector = options.schemaInspector ?? createPostgresSchemaInspector({ workspace: options.workspace ?? ownWorkspace!, binariesDir: options.binariesDir ?? process.env.OM_BACKUP_BINARIES_DIR ?? '', maxStagingBytes: options.maxStagingBytes, signal: options.signal })
  const totals = new Map<string,{rows:bigint;chunks:number}>()
  const fullScope=chunks===artifact.index.chunks
  if(fullScope)for(const entity of artifact.index.entities)totals.set(entity.key,{rows:0n,chunks:0})
  const completed = new Map<string,{rows:bigint;bytes:bigint;chunks:number}>()
  for(const chunk of chunks) if(chunk.entityKey){const total=totals.get(chunk.entityKey)??{rows:0n,chunks:0};total.rows+=BigInt(chunk.rows);total.chunks++;totals.set(chunk.entityKey,total)}
  const overallTotal=String([...totals.values()].reduce((sum,total)=>sum+total.rows,0n));let overallDone=0n
  let entitiesDone=0
  const started=new Set<string>()
  const runId=artifact.manifest.backupId
  options.progress?.({schemaVersion:1,type:'run.started',runId,entitiesTotal:totals.size,entitiesDone:0,overallRowsDone:'0',overallRowsTotal:overallTotal,overallRowsTotalExact:true,phase:'verify',rowsDone:'0',rowsTotal:'0',rowsTotalExact:true,bytesDone:'0',chunksDone:0,chunksTotal:chunks.length,at:new Date().toISOString()})
  try {
    for (const chunk of chunks) {
      if(chunk.entityKey&&!started.has(chunk.entityKey)){started.add(chunk.entityKey);options.progress?.({schemaVersion:1,type:'entity.progress',runId,entityKey:chunk.entityKey,entity:artifact.index.entities.find(entity=>entity.key===chunk.entityKey)?.label,entitiesTotal:totals.size,entitiesDone,overallRowsDone:String(overallDone),overallRowsTotal:overallTotal,overallRowsTotalExact:true,rowsDone:'0',rowsTotal:String(totals.get(chunk.entityKey)!.rows),rowsTotalExact:true,bytesDone:'0',chunksDone:0,chunksTotal:totals.get(chunk.entityKey)!.chunks,at:new Date().toISOString()})}
      if(chunk.section) await inspector(verifiedChunk(options,artifact.manifest,chunk),artifact.manifest.serverMajor)
      else for await (const block of authenticatedChunk(options, artifact.manifest, chunk)) { checkAbort(options.signal); void block }
      if(chunk.entityKey){
        const done=completed.get(chunk.entityKey)??{rows:0n,bytes:0n,chunks:0};done.rows+=BigInt(chunk.rows);done.bytes+=BigInt(chunk.cipherBytes);done.chunks++;completed.set(chunk.entityKey,done)
        const total=totals.get(chunk.entityKey)!;overallDone+=BigInt(chunk.rows);if(done.chunks===total.chunks)entitiesDone++
        options.progress?.({schemaVersion:1,type:done.chunks===total.chunks?'entity.done':'entity.progress',runId,entityKey:chunk.entityKey,entitiesTotal:totals.size,entitiesDone,overallRowsDone:String(overallDone),overallRowsTotal:overallTotal,overallRowsTotalExact:true,entity:artifact.index.entities.find((entity)=>entity.key===chunk.entityKey)?.label,rowsDone:String(done.rows),rowsTotal:String(total.rows),rowsTotalExact:true,bytesDone:String(done.bytes),chunksDone:done.chunks,chunksTotal:total.chunks,at:new Date().toISOString()})
      }
    }
    if(fullScope)for(const entity of artifact.index.entities)if(!started.has(entity.key)){entitiesDone++;options.progress?.({schemaVersion:1,type:'entity.done',runId,entityKey:entity.key,entity:entity.label,entitiesTotal:totals.size,entitiesDone,overallRowsDone:String(overallDone),overallRowsTotal:overallTotal,overallRowsTotalExact:true,rowsDone:'0',rowsTotal:'0',rowsTotalExact:true,bytesDone:'0',chunksDone:0,chunksTotal:0,at:new Date().toISOString()})}
    options.progress?.({schemaVersion:1,type:'run.finished',runId,entitiesTotal:totals.size,entitiesDone:totals.size,overallRowsDone:overallTotal,overallRowsTotal:overallTotal,overallRowsTotalExact:true,phase:'verify',rowsDone:String([...totals.values()].reduce((sum,total)=>sum+total.rows,0n)),rowsTotal:String([...totals.values()].reduce((sum,total)=>sum+total.rows,0n)),rowsTotalExact:true,bytesDone:artifact.manifest.totalCipherBytes,chunksDone:chunks.length,chunksTotal:chunks.length,at:new Date().toISOString()})
  } finally {if(ownWorkspace) await rm(ownWorkspace,{recursive:true,force:true})}
}

export async function verifyBackup(options: VerifyBackupOptions): Promise<VerifiedBackup> {
  const artifact=await readBackup(options)
  await verifyBackupChunks(options,artifact,artifact.index.chunks)
  return artifact
}
