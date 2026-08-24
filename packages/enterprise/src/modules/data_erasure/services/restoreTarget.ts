import { PrivacyServiceError } from './errors'

export function assertActiveDatabaseIsRestoreTarget(environment: NodeJS.ProcessEnv = process.env): void {
  const active = environment.DATABASE_URL?.trim()
  const restore = environment.OM_BACKUP_RESTORE_DATABASE_URL?.trim()
  if (!active || !restore) {
    throw new PrivacyServiceError(
      'DATABASE_URL and OM_BACKUP_RESTORE_DATABASE_URL are required.',
      'RESTORE_DATABASE_REQUIRED',
      409,
    )
  }
  if (databaseIdentity(active) !== databaseIdentity(restore)) {
    throw new PrivacyServiceError(
      'The active database is not the configured restore target.',
      'RESTORE_TARGET_MISMATCH',
      409,
    )
  }
}

function databaseIdentity(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error('protocol')
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).trim()
    if (!parsed.hostname || !database) throw new Error('target')
    return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${database}`
  } catch {
    throw new PrivacyServiceError('Invalid database URL.', 'INVALID_DATABASE_URL', 400)
  }
}
