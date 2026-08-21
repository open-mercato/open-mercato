export const BACKUP_FORMAT = 'open-mercato-database-backup'
export const BACKUP_FORMAT_VERSION = 1

export type BackupManifest = {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  operationId: string
  label: string | null
  actor: string
  scope: 'instance'
  applicationVersion: string
  createdAt: string
  completedAt: string
  source: {
    databaseFingerprint: string
  }
  schema: {
    version: string
    fingerprintSha256: string
    migrationCount: number
  }
  postgres: {
    pgDumpVersion: string
  }
  encryption: {
    algorithm: 'aes-256-gcm'
    ivBase64: string
    authTagBase64: string
    keyFingerprint: string
  }
  archive: {
    fileName: string
    checksumSha256: string
    sizeBytes: number
  }
  result: 'completed'
}

export type BackupAuditReceipt = {
  receiptVersion: 1
  receiptId: string
  operationId: string
  backupOperationId: string | null
  operationType: 'backup' | 'verify' | 'restore'
  phase: 'started' | 'completed' | 'failed'
  actor: string
  scope: 'instance'
  occurredAt: string
  archiveChecksumSha256: string | null
  schemaVersion: string | null
  sourceDatabaseFingerprint: string | null
  targetDatabaseFingerprint: string | null
  dryRun: boolean
  result: 'started' | 'completed' | 'failed'
  errorCode: string | null
  signature: {
    algorithm: 'hmac-sha256'
    keyFingerprint: string
    valueBase64: string
  }
}

export type BackupOperationResult = {
  operationId: string
  archivePath: string
  manifestPath: string
  manifest: BackupManifest
}

export type RestoreOperationResult = {
  operationId: string
  manifest: BackupManifest
  dryRun: boolean
  targetDatabaseFingerprint: string | null
  pendingErasureActions: ErasureManifestEntry[]
}

export type ErasureManifestEntry = {
  version: 1
  requestId: string
  tenantId: string
  organizationId: string
  subjectKind: string
  subjectId: string
  executedAt: string
}

export type ErasureManifestServiceContract = {
  append: (input: Omit<ErasureManifestEntry, 'version' | 'executedAt'> & { executedAt: Date }) => Promise<void>
  listAfter: (timestamp: Date) => Promise<ErasureManifestEntry[]>
}

export type BackupServiceOptions = {
  databaseUrl: string
  restoreDatabaseUrl?: string
  backupDirectory: string
  auditDirectory: string
  encryptionKey: Buffer
  auditHmacKey: Buffer
  actor: string
  applicationVersion: string
  erasureManifestService?: ErasureManifestServiceContract
  environment?: NodeJS.ProcessEnv
  tools?: Partial<{
    pgDump: string
    pgRestore: string
    psql: string
  }>
  now?: () => Date
  randomId?: () => string
}

export type MigrationState = {
  version: string
  fingerprintSha256: string
  migrationCount: number
}
