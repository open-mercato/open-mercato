export type ExistingDatabaseDecision = 'proceed' | 'skip' | 'abort'

export function decideExistingDatabase(existingUsersCount: number, skipIfInitialized: boolean): ExistingDatabaseDecision {
  if (!Number.isFinite(existingUsersCount) || existingUsersCount <= 0) return 'proceed'
  return skipIfInitialized ? 'skip' : 'abort'
}

export function describeDatabaseTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || '(default database)'
    const host = url.hostname || 'localhost'
    return `${host}${url.port ? `:${url.port}` : ''}/${database}`
  } catch {
    return 'the database from DATABASE_URL'
  }
}

export function formatSkipIfInitializedMessage(existingUsersCount: number, databaseUrl: string): string[] {
  return [
    `✅ Database already initialized (${existingUsersCount} user(s) in ${describeDatabaseTarget(databaseUrl)}) — keeping the existing data and skipping the first-run seed.`,
    '   Not the database you expected? Check DATABASE_URL in .env. To wipe it and seed from scratch: yarn mercato init --reinstall',
  ]
}
