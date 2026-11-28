import { createHash } from 'node:crypto'
import { z } from 'zod'
import { decryptWithAesGcmStrict } from '@open-mercato/shared/lib/encryption/aes'
import { checksSchema } from './schemas'
import { restoreBackup, type RestoreBackupOptions } from './restore'
import { readBackup } from './verify'
import { readBoundedFile } from './artifacts'
import { BackupError } from './errors'

export async function exerciseBackup(options: RestoreBackupOptions & { checksFile: string; canaryKeysFile?: string }) {
  const checksBytes = await readBoundedFile(options.checksFile, 1024 * 1024)
  const checks = checksSchema.parse(JSON.parse(checksBytes.toString()))
  const artifact = await readBackup(options)
  const keySchema = z.record(z.string(), z.string().regex(/^[A-Za-z0-9+/]{43}=$/)).refine((keys) => Object.keys(keys).length <= 100)
  const keys = options.canaryKeysFile ? keySchema.parse(JSON.parse((await readBoundedFile(options.canaryKeysFile, 1024 * 1024)).toString())) : {}
  for (const check of checks) {
    if (check.type === 'encrypted-canary' && (!Object.hasOwn(keys, check.keyHandle) || !keys[check.keyHandle] || !options.target.readCanary)) throw new BackupError('BACKUP_CANARY_CUSTODY_REQUIRED',3)
  }
  return restoreBackup({ ...options, async afterDataVerified(target) {
    if (!target.migrationFingerprint || await target.migrationFingerprint() !== artifact.index.migrationFingerprint) throw new BackupError('BACKUP_MIGRATION_FINGERPRINT_FAILED',6)
    for (const check of checks) {
      if (check.type === 'artifact-integrity') continue
      if (check.type === 'migration-fingerprint') {
        if (check.expectedSha256 && artifact.index.migrationFingerprint !== check.expectedSha256) throw new BackupError('BACKUP_MIGRATION_FINGERPRINT_FAILED',6)
        continue
      }
      const entity = artifact.index.entities.find((entry) => entry.key === check.entityKey)
      if (!entity) throw new BackupError('BACKUP_CHECK_UNKNOWN_ENTITY',3)
      if (check.type === 'row-count') {
        const count = BigInt(await target.countRows(entity))
        if (count < BigInt(check.minimum) || count > BigInt(check.maximum)) throw new BackupError('BACKUP_RECOVERY_CHECK_FAILED',6)
      } else {
        if (!target.readCanary) throw new BackupError('BACKUP_CANARY_UNSUPPORTED',3)
        try {
          const envelope=await target.readCanary(entity,{field:check.field,key:check.key})
          const plaintext=decryptWithAesGcmStrict(envelope,keys[check.keyHandle])
          if(createHash('sha256').update(plaintext).digest('hex')!==check.expectedSha256) throw new BackupError('BACKUP_CANARY_FAILED',6)
        } catch { throw new BackupError('BACKUP_CANARY_FAILED',6) }
      }
    }
    const additional=await options.afterDataVerified?.(target)
    const testedCanaries=checks.filter((check)=>check.type==='encrypted-canary').length
    return { keyRecovery:{status:testedCanaries?'passed' as const:'not-tested' as const,testedCanaries},checks:[...checks.map((check)=>({type:check.type,status:'passed' as const,...('entityKey' in check?{entityKey:check.entityKey}:{})})),...(additional?.checks??[])] }
  } })
}
