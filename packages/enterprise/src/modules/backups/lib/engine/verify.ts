import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { manifestSchema, indexSchema, type Manifest, type BackupIndex, type Chunk } from './schemas'
import type { ByteStream, EngineContext } from './types'
import { privateDirectory, privateFile, contained, digestFile, readBoundedFile } from './artifacts'
import { decryptBytes, decryptStream } from './crypto'
import { transform } from './streams'
import { BackupError, checkAbort } from './errors'

export type VerifyBackupOptions = EngineContext & { artifact: string; trustedManifestSha256: string; identities?: string[]; metadataOnly?: boolean }
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
  return { manifest, index }
}
export async function readBackup(options: VerifyBackupOptions): Promise<VerifiedBackup> {
  try { return await readBackupInternal(options) }
  catch (error) { if (error instanceof BackupError) throw error; throw new BackupError('BACKUP_ARTIFACT_INTEGRITY_FAILED', 4) }
}
export async function* verifiedChunk(options: VerifyBackupOptions, manifest: Manifest, chunk: Chunk): ByteStream {
  const path = await contained(options.artifact, chunk.path)
  await privateFile(path)
  const hash = createHash('sha256')
  let cipherBytes = 0n
  let plainBytes = 0n
  async function* input() {
    for await (const block of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
      checkAbort(options.signal)
      cipherBytes += BigInt(block.byteLength)
      if (cipherBytes > BigInt(chunk.cipherBytes)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
      hash.update(block)
      yield block
    }
  }
  try {
    const decoded = manifest.encryption.mode === 'age-v1' ? await decryptStream(input(), options.identities ?? []) : input()
    for await (const block of transform(decoded, createGunzip())) {
      plainBytes += BigInt(block.byteLength)
      if (plainBytes > BigInt(chunk.plainBytes)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
      yield block
    }
    if (cipherBytes !== BigInt(chunk.cipherBytes) || plainBytes !== BigInt(chunk.plainBytes) || !equalDigest(hash.digest('hex'), chunk.sha256)) throw new BackupError('BACKUP_CHUNK_INTEGRITY_FAILED', 4)
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('BACKUP_CHUNK_AUTHENTICATION_FAILED', 4)
  }
}
export async function verifyBackup(options: VerifyBackupOptions): Promise<VerifiedBackup> {
  const artifact = await readBackup(options)
  if (options.metadataOnly) return artifact
  for (const chunk of artifact.index.chunks) for await (const block of verifiedChunk(options, artifact.manifest, chunk)) { checkAbort(options.signal); void block }
  return artifact
}
