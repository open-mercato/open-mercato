import { readFile } from 'node:fs/promises'
import { checksSchema } from './schemas'
import { restoreBackup, type RestoreBackupOptions } from './restore'
import { readBackup } from './verify'
import { BackupError } from './errors'

export async function exerciseBackup(options: RestoreBackupOptions & { checksFile: string }) {
  const checksBytes = await readFile(options.checksFile)
  if (checksBytes.byteLength > 1024 * 1024) throw new BackupError('BACKUP_CHECKS_LIMIT', 3)
  const checks = checksSchema.parse(JSON.parse(checksBytes.toString()))
  const artifact = await readBackup(options)
  return restoreBackup({ ...options, async afterDataVerified(target) {
    for (const check of checks) {
      if (check.type === 'artifact-integrity') continue
      const entity = artifact.index.entities.find((entry) => entry.key === check.entityKey)
      if (!entity) throw new BackupError('BACKUP_CHECK_UNKNOWN_ENTITY', 3)
      const count = BigInt(await target.countRows(entity))
      if (count < BigInt(check.minimum) || count > BigInt(check.maximum)) throw new BackupError('BACKUP_RECOVERY_CHECK_FAILED', 6)
    }
    await options.afterDataVerified?.(target)
  } })
}
