import { readFile, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { manifestSchema } from './schemas'
import { privateDirectory, privateFile } from './artifacts'
import { BackupError } from './errors'

export async function getBackupStatus(artifact: string) {
  await privateDirectory(artifact)
  const manifestPath = join(artifact, 'manifest.json')
  const info = await lstat(manifestPath).catch(() => null)
  if (info) {
    await privateFile(manifestPath)
    if (info.size > 1024 * 1024) throw new BackupError('BACKUP_MANIFEST_LIMIT', 4)
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
    return { schemaVersion: 1, status: 'completed', backupId: manifest.backupId, chunkCount: manifest.chunkCount, consistency: manifest.consistency.mode, encryption: manifest.encryption.mode }
  }
  const files = await readdir(artifact)
  if (!files.includes('journal.jsonl') && !files.includes('prepare.age')) throw new BackupError('BACKUP_ARTIFACT_INVALID', 3)
  const lockPath = join(artifact, 'lock')
  let heartbeat: string | undefined
  try {
    await privateFile(lockPath)
    const lock: unknown = JSON.parse(await readFile(lockPath, 'utf8'))
    if (lock && typeof lock === 'object' && 'heartbeatAt' in lock && typeof lock.heartbeatAt === 'string') heartbeat = lock.heartbeatAt
  } catch { heartbeat = undefined }
  return { schemaVersion: 1, status: 'resumable', heartbeatAt: heartbeat }
}
