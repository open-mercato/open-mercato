import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  type BackupOperationResult,
  type BackupServiceOptions,
  type MigrationState,
  type RestoreOperationResult,
} from './contracts'
import { writeAuditReceipt } from './auditReceipts'
import { ErasureManifestService, resolveErasureManifestDirectory } from './erasureManifest'

const ARCHIVE_EXTENSION = '.ombak'
const MANIFEST_EXTENSION = '.manifest.json'
const MAX_STDERR_LENGTH = 2_000
const ENTERPRISE_PACKAGE_VERSION = readPackageVersion()

type DatabaseConnection = {
  databaseName: string
  fingerprint: string
  environment: NodeJS.ProcessEnv
}

type ToolVersions = {
  pgDump: string
  pgRestore: string
}

type OperationType = 'backup' | 'verify' | 'restore'

export class BackupServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'BackupServiceError'
  }
}

export class BackupService {
  private readonly environment: NodeJS.ProcessEnv
  private readonly tools: { pgDump: string; pgRestore: string; psql: string }
  private readonly now: () => Date
  private readonly randomId: () => string

  constructor(private readonly options: BackupServiceOptions) {
    this.environment = { ...(options.environment ?? process.env) }
    this.tools = {
      pgDump: options.tools?.pgDump ?? this.environment.OM_BACKUP_PG_DUMP_PATH ?? 'pg_dump',
      pgRestore: options.tools?.pgRestore ?? this.environment.OM_BACKUP_PG_RESTORE_PATH ?? 'pg_restore',
      psql: options.tools?.psql ?? this.environment.OM_BACKUP_PSQL_PATH ?? 'psql',
    }
    this.now = options.now ?? (() => new Date())
    this.randomId = options.randomId ?? randomUUID

    if (!options.actor.trim()) {
      throw new BackupServiceError('The backup actor is required.', 'ACTOR_REQUIRED')
    }
    if (options.encryptionKey.length !== 32) {
      throw new BackupServiceError('OM_BACKUP_ENCRYPTION_KEY must contain exactly 32 bytes.', 'INVALID_ENCRYPTION_KEY')
    }
    if (options.auditHmacKey.length < 32) {
      throw new BackupServiceError('The backup audit HMAC key must contain at least 32 bytes.', 'INVALID_AUDIT_KEY')
    }
  }

  async backup(input: { label?: string | null } = {}): Promise<BackupOperationResult> {
    const operationId = this.randomId()
    const source = parseDatabaseConnection(this.options.databaseUrl)
    const startedAt = this.now().toISOString()
    const label = normalizeLabel(input.label)
    let archivePath: string | null = null
    let partialArchivePath: string | null = null
    let manifestPath: string | null = null
    let schemaState: MigrationState | null = null

    await this.writeReceipt({
      operationId,
      backupOperationId: operationId,
      operationType: 'backup',
      phase: 'started',
      occurredAt: startedAt,
      sourceDatabaseFingerprint: source.fingerprint,
    })

    try {
      const versions = await this.readToolVersions(source.environment)
      schemaState = await this.readMigrationState(source)
      await mkdir(this.options.backupDirectory, { recursive: true, mode: 0o700 })

      const archiveFileName = `${operationId}${ARCHIVE_EXTENSION}`
      archivePath = path.join(this.options.backupDirectory, archiveFileName)
      partialArchivePath = `${archivePath}.partial`
      const encryption = await this.createEncryptedDump(source, partialArchivePath)
      await rename(partialArchivePath, archivePath)
      partialArchivePath = null
      const archiveStats = await stat(archivePath)
      const completedAt = this.now().toISOString()
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        operationId,
        label,
        actor: this.options.actor.trim(),
        scope: 'instance',
        applicationVersion: this.options.applicationVersion,
        createdAt: startedAt,
        completedAt,
        source: {
          databaseFingerprint: source.fingerprint,
        },
        schema: schemaState,
        postgres: {
          pgDumpVersion: versions.pgDump,
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          ivBase64: encryption.iv.toString('base64'),
          authTagBase64: encryption.authTag.toString('base64'),
          keyFingerprint: fingerprintKey(this.options.encryptionKey),
        },
        archive: {
          fileName: archiveFileName,
          checksumSha256: encryption.checksumSha256,
          sizeBytes: archiveStats.size,
        },
        result: 'completed',
      }
      manifestPath = path.join(this.options.backupDirectory, `${operationId}${MANIFEST_EXTENSION}`)
      await writeJsonAtomically(manifestPath, manifest)
      await this.writeReceipt({
        operationId,
        backupOperationId: operationId,
        operationType: 'backup',
        phase: 'completed',
        occurredAt: completedAt,
        archiveChecksumSha256: manifest.archive.checksumSha256,
        schemaVersion: manifest.schema.version,
        sourceDatabaseFingerprint: source.fingerprint,
      })
      return { operationId, archivePath, manifestPath, manifest }
    } catch (error) {
      await removeIfPresent(partialArchivePath)
      await removeIfPresent(archivePath)
      await removeIfPresent(manifestPath)
      await this.writeFailureReceipt({
        operationId,
        backupOperationId: operationId,
        operationType: 'backup',
        sourceDatabaseFingerprint: source.fingerprint,
        schemaVersion: schemaState?.version ?? null,
        error,
      })
      throw normalizeError(error)
    }
  }

  async verify(reference: string): Promise<RestoreOperationResult> {
    return this.runRestoreLikeOperation({ reference, operationType: 'verify', dryRun: true })
  }

  async restore(input: {
    reference: string
    dryRun: boolean
    force?: boolean
    confirmDatabase?: string
    allowVersionMismatch?: boolean
  }): Promise<RestoreOperationResult> {
    if (!input.dryRun && !input.force) {
      throw new BackupServiceError('A restore requires --force.', 'RESTORE_FORCE_REQUIRED')
    }
    return this.runRestoreLikeOperation({
      reference: input.reference,
      operationType: 'restore',
      dryRun: input.dryRun,
      force: input.force,
      confirmDatabase: input.confirmDatabase,
      allowVersionMismatch: input.allowVersionMismatch,
    })
  }

  private async runRestoreLikeOperation(input: {
    reference: string
    operationType: 'verify' | 'restore'
    dryRun: boolean
    force?: boolean
    confirmDatabase?: string
    allowVersionMismatch?: boolean
  }): Promise<RestoreOperationResult> {
    const manifestPath = await resolveManifestPath(input.reference, this.options.backupDirectory)
    const manifest = await readBackupManifest(manifestPath)
    const archivePath = resolveArchivePath(manifestPath, manifest)
    const operationId = this.randomId()
    const target = input.dryRun ? null : this.resolveRestoreTarget(input.confirmDatabase)
    const startedAt = this.now().toISOString()

    await this.writeReceipt({
      operationId,
      backupOperationId: manifest.operationId,
      operationType: input.operationType,
      phase: 'started',
      occurredAt: startedAt,
      archiveChecksumSha256: manifest.archive.checksumSha256,
      schemaVersion: manifest.schema.version,
      sourceDatabaseFingerprint: manifest.source.databaseFingerprint,
      targetDatabaseFingerprint: target?.fingerprint ?? null,
      dryRun: input.dryRun,
    })

    try {
      await this.assertArchiveCompatible(manifest, archivePath, input.allowVersionMismatch === true)
      if (input.dryRun) {
        await this.pipeDecryptedArchiveToRestore(manifest, archivePath, ['--list'])
      } else if (target) {
        await this.assertTargetSafe(target, input.force === true)
        await this.pipeDecryptedArchiveToRestore(
          manifest,
          archivePath,
          [
            '--exit-on-error',
            '--no-owner',
            '--no-privileges',
            '--clean',
            '--if-exists',
            `--dbname=${target.databaseName}`,
          ],
          target.environment,
        )
        const restoredSchema = await this.readMigrationState(target)
        if (restoredSchema.fingerprintSha256 !== manifest.schema.fingerprintSha256) {
          throw new BackupServiceError(
            'The restored migration state does not match the backup manifest.',
            'RESTORED_SCHEMA_MISMATCH',
          )
        }
      }

      await this.writeReceipt({
        operationId,
        backupOperationId: manifest.operationId,
        operationType: input.operationType,
        phase: 'completed',
        occurredAt: this.now().toISOString(),
        archiveChecksumSha256: manifest.archive.checksumSha256,
        schemaVersion: manifest.schema.version,
        sourceDatabaseFingerprint: manifest.source.databaseFingerprint,
        targetDatabaseFingerprint: target?.fingerprint ?? null,
        dryRun: input.dryRun,
      })
      const pendingErasureActions = await this.resolveErasureManifestService()
        .listAfter(new Date(manifest.completedAt))
      return {
        operationId,
        manifest,
        dryRun: input.dryRun,
        targetDatabaseFingerprint: target?.fingerprint ?? null,
        pendingErasureActions,
      }
    } catch (error) {
      await this.writeFailureReceipt({
        operationId,
        backupOperationId: manifest.operationId,
        operationType: input.operationType,
        archiveChecksumSha256: manifest.archive.checksumSha256,
        schemaVersion: manifest.schema.version,
        sourceDatabaseFingerprint: manifest.source.databaseFingerprint,
        targetDatabaseFingerprint: target?.fingerprint ?? null,
        dryRun: input.dryRun,
        error,
      })
      throw normalizeError(error)
    }
  }

  private resolveErasureManifestService() {
    return this.options.erasureManifestService ?? new ErasureManifestService(
      resolveErasureManifestDirectory(this.options.backupDirectory, this.environment),
    )
  }

  private resolveRestoreTarget(confirmDatabase?: string): DatabaseConnection {
    if (!this.options.restoreDatabaseUrl) {
      throw new BackupServiceError(
        'OM_BACKUP_RESTORE_DATABASE_URL is required for restore.',
        'RESTORE_DATABASE_REQUIRED',
      )
    }
    const target = parseDatabaseConnection(this.options.restoreDatabaseUrl)
    if (confirmDatabase !== target.databaseName) {
      throw new BackupServiceError(
        `Pass --confirm ${target.databaseName} to confirm the restore target.`,
        'RESTORE_CONFIRMATION_REQUIRED',
      )
    }
    return target
  }

  private async assertTargetSafe(target: DatabaseConnection, force: boolean): Promise<void> {
    const stdout = await this.runBuffered(
      this.tools.psql,
      [
        '-XAtq',
        '--no-password',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');",
      ],
      target.environment,
    )
    const tableCount = Number.parseInt(stdout.trim(), 10)
    if (!Number.isFinite(tableCount)) {
      throw new BackupServiceError('Could not inspect the restore target.', 'TARGET_INSPECTION_FAILED')
    }
    if (tableCount > 0 && !force) {
      throw new BackupServiceError('The restore target is not empty. Pass --force to continue.', 'TARGET_NOT_EMPTY')
    }
  }

  private async assertArchiveCompatible(
    manifest: BackupManifest,
    archivePath: string,
    allowVersionMismatch: boolean,
  ): Promise<void> {
    await access(archivePath)
    const checksum = await checksumFile(archivePath)
    if (checksum !== manifest.archive.checksumSha256) {
      throw new BackupServiceError('Backup archive checksum verification failed.', 'CHECKSUM_MISMATCH')
    }
    if (fingerprintKey(this.options.encryptionKey) !== manifest.encryption.keyFingerprint) {
      throw new BackupServiceError('The configured encryption key does not match this backup.', 'KEY_MISMATCH')
    }
    try {
      await this.authenticateArchive(manifest, archivePath)
    } catch {
      throw new BackupServiceError('Backup archive authentication failed.', 'ARCHIVE_AUTHENTICATION_FAILED')
    }
    if (!allowVersionMismatch && manifest.applicationVersion !== this.options.applicationVersion) {
      throw new BackupServiceError(
        `Backup application version ${manifest.applicationVersion} does not match ${this.options.applicationVersion}.`,
        'APPLICATION_VERSION_MISMATCH',
      )
    }
    const pgRestoreVersion = await this.readToolVersion(this.tools.pgRestore, 'pg_restore')
    const dumpMajor = parsePostgresMajor(manifest.postgres.pgDumpVersion)
    const restoreMajor = parsePostgresMajor(pgRestoreVersion)
    if (!allowVersionMismatch && restoreMajor < dumpMajor) {
      throw new BackupServiceError(
        `pg_restore ${pgRestoreVersion} is older than the backup tool ${manifest.postgres.pgDumpVersion}.`,
        'POSTGRES_VERSION_MISMATCH',
      )
    }
  }

  private async createEncryptedDump(
    source: DatabaseConnection,
    destinationPath: string,
  ): Promise<{ iv: Buffer; authTag: Buffer; checksumSha256: string }> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.options.encryptionKey, iv)
    const checksum = createHash('sha256')
    const checksumTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        checksum.update(chunk)
        callback(null, chunk)
      },
    })
    const child = this.spawnTool(
      this.tools.pgDump,
      ['--format=custom', '--no-owner', '--no-privileges', '--no-password'],
      source.environment,
    )
    const processDone = waitForProcess(child, this.tools.pgDump)
    await Promise.all([
      pipeline(
        child.stdout,
        cipher,
        checksumTransform,
        createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
      ),
      processDone,
    ])
    return {
      iv,
      authTag: cipher.getAuthTag(),
      checksumSha256: checksum.digest('hex'),
    }
  }

  private async pipeDecryptedArchiveToRestore(
    manifest: BackupManifest,
    archivePath: string,
    args: string[],
    environment: NodeJS.ProcessEnv = {},
  ): Promise<void> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.options.encryptionKey,
      Buffer.from(manifest.encryption.ivBase64, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(manifest.encryption.authTagBase64, 'base64'))
    const child = this.spawnTool(this.tools.pgRestore, args, environment)
    const processDone = waitForProcess(child, this.tools.pgRestore)
    await Promise.all([
      pipeline(createReadStream(archivePath), decipher, child.stdin),
      processDone,
    ])
  }

  private async authenticateArchive(manifest: BackupManifest, archivePath: string): Promise<void> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.options.encryptionKey,
      Buffer.from(manifest.encryption.ivBase64, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(manifest.encryption.authTagBase64, 'base64'))
    await pipeline(
      createReadStream(archivePath),
      decipher,
      new Writable({
        write(_chunk: Buffer, _encoding, callback) {
          callback()
        },
      }),
    )
  }

  private async readMigrationState(connection: DatabaseConnection): Promise<MigrationState> {
    const tableOutput = await this.runBuffered(
      this.tools.psql,
      [
        '-XAtq',
        '--no-password',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'mikro_orm_migrations%' ORDER BY table_name;",
      ],
      connection.environment,
    )
    const tableNames = tableOutput.split('\n').map((value) => value.trim()).filter(Boolean)
    const migrations: string[] = []
    for (const tableName of tableNames) {
      if (!/^mikro_orm_migrations(?:_[a-z0-9_]+)?$/.test(tableName)) {
        throw new BackupServiceError('Unexpected migration table name.', 'INVALID_MIGRATION_TABLE')
      }
      const migrationOutput = await this.runBuffered(
        this.tools.psql,
        [
          '-XAtq',
          '--no-password',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `SELECT name FROM "${tableName}" ORDER BY name;`,
        ],
        connection.environment,
      )
      for (const migrationName of migrationOutput.split('\n').map((value) => value.trim()).filter(Boolean)) {
        migrations.push(`${tableName}:${migrationName}`)
      }
    }
    const ordered = migrations.sort()
    return {
      version: ordered.at(-1) ?? 'unversioned',
      fingerprintSha256: createHash('sha256').update(ordered.join('\n')).digest('hex'),
      migrationCount: ordered.length,
    }
  }

  private async readToolVersions(environment: NodeJS.ProcessEnv): Promise<ToolVersions> {
    const [pgDump, pgRestore] = await Promise.all([
      this.readToolVersion(this.tools.pgDump, 'pg_dump', environment),
      this.readToolVersion(this.tools.pgRestore, 'pg_restore', environment),
    ])
    const dumpMajor = parsePostgresMajor(pgDump)
    const restoreMajor = parsePostgresMajor(pgRestore)
    if (restoreMajor < dumpMajor) {
      throw new BackupServiceError(
        `pg_restore ${pgRestore} is older than pg_dump ${pgDump}.`,
        'POSTGRES_VERSION_MISMATCH',
      )
    }
    return { pgDump, pgRestore }
  }

  private async readToolVersion(
    tool: string,
    expectedName: string,
    environment: NodeJS.ProcessEnv = {},
  ): Promise<string> {
    const output = await this.runBuffered(tool, ['--version'], environment)
    const match = output.match(new RegExp(`${expectedName}\\s+\\(PostgreSQL\\)\\s+([^\\s]+)`, 'i'))
    if (!match?.[1]) {
      throw new BackupServiceError(`Could not read ${expectedName} version.`, 'TOOL_VERSION_UNAVAILABLE')
    }
    return match[1]
  }

  private spawnTool(
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
  ): ChildProcessWithoutNullStreams {
    return spawn(command, args, {
      env: { ...this.environment, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
  }

  private async runBuffered(
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<string> {
    const child = this.spawnTool(command, args, environment)
    child.stdin.end()
    const stdout: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    await waitForProcess(child, command)
    return Buffer.concat(stdout).toString('utf8')
  }

  private async writeReceipt(input: {
    operationId: string
    backupOperationId?: string | null
    operationType: OperationType
    phase: 'started' | 'completed'
    occurredAt: string
    archiveChecksumSha256?: string | null
    schemaVersion?: string | null
    sourceDatabaseFingerprint?: string | null
    targetDatabaseFingerprint?: string | null
    dryRun?: boolean
  }): Promise<void> {
    await writeAuditReceipt({
      auditDirectory: this.options.auditDirectory,
      hmacKey: this.options.auditHmacKey,
      randomId: this.randomId,
      receipt: {
        operationId: input.operationId,
        backupOperationId: input.backupOperationId ?? null,
        operationType: input.operationType,
        phase: input.phase,
        actor: this.options.actor.trim(),
        scope: 'instance',
        occurredAt: input.occurredAt,
        archiveChecksumSha256: input.archiveChecksumSha256 ?? null,
        schemaVersion: input.schemaVersion ?? null,
        sourceDatabaseFingerprint: input.sourceDatabaseFingerprint ?? null,
        targetDatabaseFingerprint: input.targetDatabaseFingerprint ?? null,
        dryRun: input.dryRun ?? false,
        result: input.phase,
        errorCode: null,
      },
    })
  }

  private async writeFailureReceipt(input: {
    operationId: string
    backupOperationId?: string | null
    operationType: OperationType
    archiveChecksumSha256?: string | null
    schemaVersion?: string | null
    sourceDatabaseFingerprint?: string | null
    targetDatabaseFingerprint?: string | null
    dryRun?: boolean
    error: unknown
  }): Promise<void> {
    const normalized = normalizeError(input.error)
    await writeAuditReceipt({
      auditDirectory: this.options.auditDirectory,
      hmacKey: this.options.auditHmacKey,
      randomId: this.randomId,
      receipt: {
        operationId: input.operationId,
        backupOperationId: input.backupOperationId ?? null,
        operationType: input.operationType,
        phase: 'failed',
        actor: this.options.actor.trim(),
        scope: 'instance',
        occurredAt: this.now().toISOString(),
        archiveChecksumSha256: input.archiveChecksumSha256 ?? null,
        schemaVersion: input.schemaVersion ?? null,
        sourceDatabaseFingerprint: input.sourceDatabaseFingerprint ?? null,
        targetDatabaseFingerprint: input.targetDatabaseFingerprint ?? null,
        dryRun: input.dryRun ?? false,
        result: 'failed',
        errorCode: normalized.code,
      },
    })
  }
}

export function createBackupServiceFromEnvironment(input: {
  actor: string
  backupDirectory?: string
  environment?: NodeJS.ProcessEnv
}): BackupService {
  const environment = input.environment ?? process.env
  const backupDirectory = path.resolve(
    input.backupDirectory ?? environment.OM_BACKUP_DIRECTORY ?? path.join('.mercato', 'backups'),
  )
  const databaseUrl = environment.DATABASE_URL
  if (!databaseUrl) {
    throw new BackupServiceError('DATABASE_URL is required.', 'DATABASE_URL_REQUIRED')
  }
  const encryptionKey = parseSecretKey(environment.OM_BACKUP_ENCRYPTION_KEY, 'OM_BACKUP_ENCRYPTION_KEY', 32)
  const auditHmacKey = parseSecretKey(
    environment.OM_BACKUP_AUDIT_HMAC_KEY?.trim() || environment.OM_AUDIT_EVIDENCE_HMAC_KEY,
    'OM_BACKUP_AUDIT_HMAC_KEY or OM_AUDIT_EVIDENCE_HMAC_KEY',
    32,
  )
  return new BackupService({
    databaseUrl,
    restoreDatabaseUrl: environment.OM_BACKUP_RESTORE_DATABASE_URL?.trim() || undefined,
    backupDirectory,
    auditDirectory: path.resolve(
      environment.OM_BACKUP_AUDIT_DIRECTORY?.trim() || path.join(backupDirectory, 'audit'),
    ),
    encryptionKey,
    auditHmacKey,
    actor: input.actor,
    applicationVersion: ENTERPRISE_PACKAGE_VERSION,
    erasureManifestService: new ErasureManifestService(
      resolveErasureManifestDirectory(backupDirectory, environment),
    ),
    environment,
  })
}

export async function listBackupManifests(directory: string): Promise<Array<{
  manifestPath: string
  manifest: BackupManifest
}>> {
  const resolved = path.resolve(directory)
  let entries: string[]
  try {
    entries = await readdir(resolved)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(MANIFEST_EXTENSION))
      .map(async (entry) => {
        const manifestPath = path.join(resolved, entry)
        return { manifestPath, manifest: await readBackupManifest(manifestPath) }
      }),
  )
  return manifests.sort((left, right) => right.manifest.completedAt.localeCompare(left.manifest.completedAt))
}

export async function readBackupManifest(filePath: string): Promise<BackupManifest> {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  if (!isBackupManifest(parsed)) {
    throw new BackupServiceError('Invalid backup manifest.', 'INVALID_MANIFEST')
  }
  if (path.basename(parsed.archive.fileName) !== parsed.archive.fileName) {
    throw new BackupServiceError('Backup manifest contains an unsafe archive path.', 'INVALID_MANIFEST')
  }
  return parsed
}

async function resolveManifestPath(reference: string, backupDirectory: string): Promise<string> {
  const directPath = path.resolve(reference)
  if (await exists(directPath)) {
    if (directPath.endsWith(MANIFEST_EXTENSION)) return directPath
    if (directPath.endsWith(ARCHIVE_EXTENSION)) {
      const derived = directPath.slice(0, -ARCHIVE_EXTENSION.length) + MANIFEST_EXTENSION
      if (await exists(derived)) return derived
    }
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(reference)) {
    throw new BackupServiceError('Backup reference was not found.', 'BACKUP_NOT_FOUND')
  }
  const manifestPath = path.join(path.resolve(backupDirectory), `${reference}${MANIFEST_EXTENSION}`)
  if (!await exists(manifestPath)) {
    throw new BackupServiceError('Backup reference was not found.', 'BACKUP_NOT_FOUND')
  }
  return manifestPath
}

function resolveArchivePath(manifestPath: string, manifest: BackupManifest): string {
  return path.join(path.dirname(manifestPath), manifest.archive.fileName)
}

function parseDatabaseConnection(databaseUrl: string): DatabaseConnection {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new BackupServiceError('Database URL is invalid.', 'INVALID_DATABASE_URL')
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new BackupServiceError('Database URL must use postgres:// or postgresql://.', 'INVALID_DATABASE_URL')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!databaseName) {
    throw new BackupServiceError('Database URL must include a database name.', 'INVALID_DATABASE_URL')
  }
  const environment: NodeJS.ProcessEnv = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: databaseName,
  }
  for (const [parameter, environmentName] of [
    ['sslmode', 'PGSSLMODE'],
    ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcert', 'PGSSLCERT'],
    ['sslkey', 'PGSSLKEY'],
  ] as const) {
    const value = parsed.searchParams.get(parameter)
    if (value) environment[environmentName] = value
  }
  const identity = `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}/${databaseName}`
  return {
    databaseName,
    fingerprint: createHash('sha256').update(identity).digest('hex').slice(0, 24),
    environment,
  }
}

function normalizeLabel(label?: string | null): string | null {
  const normalized = label?.trim() ?? ''
  if (!normalized) return null
  if (normalized.length > 80) {
    throw new BackupServiceError('Backup label must be 80 characters or fewer.', 'INVALID_LABEL')
  }
  return normalized
}

function parseSecretKey(value: string | undefined, name: string, minimumLength: number): Buffer {
  if (!value) {
    throw new BackupServiceError(`${name} is required.`, 'SECRET_KEY_REQUIRED')
  }
  const trimmed = value.trim()
  let key: Buffer
  if (/^[a-f0-9]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    key = Buffer.from(trimmed, 'hex')
  } else if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    key = Buffer.from(trimmed, 'base64')
  } else {
    throw new BackupServiceError(`${name} must be hex or base64 encoded.`, 'INVALID_SECRET_KEY')
  }
  if (key.length < minimumLength) {
    throw new BackupServiceError(`${name} must contain at least ${minimumLength} bytes.`, 'INVALID_SECRET_KEY')
  }
  return key
}

function fingerprintKey(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

function parsePostgresMajor(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10)
  if (!Number.isFinite(major)) {
    throw new BackupServiceError('Invalid PostgreSQL tool version.', 'TOOL_VERSION_UNAVAILABLE')
  }
  return major
}

async function checksumFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(
    createReadStream(filePath),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        callback(null, chunk)
      },
    }),
    new Transform({
      transform(_chunk: Buffer, _encoding, callback) {
        callback()
      },
    }),
  )
  return hash.digest('hex')
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const partialPath = `${filePath}.partial`
  try {
    await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await rename(partialPath, filePath)
  } catch (error) {
    await removeIfPresent(partialPath)
    throw error
  }
}

async function waitForProcess(child: ChildProcessWithoutNullStreams, command: string): Promise<void> {
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < MAX_STDERR_LENGTH) stderr += chunk.toString('utf8')
  })
  await new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(new BackupServiceError(
      `${path.basename(command)} could not be started: ${sanitizeErrorText(error.message)}`,
      'TOOL_START_FAILED',
    )))
    child.once('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new BackupServiceError(
        `${path.basename(command)} failed with exit code ${code ?? 'unknown'}: ${sanitizeErrorText(stderr)}`,
        'TOOL_FAILED',
      ))
    })
  })
}

function sanitizeErrorText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-database-url]')
    .replace(/password\s*=\s*[^\s]+/gi, 'password=[redacted]')
    .trim()
    .slice(0, MAX_STDERR_LENGTH)
}

function normalizeError(error: unknown): BackupServiceError {
  if (error instanceof BackupServiceError) return error
  if (error instanceof Error) {
    return new BackupServiceError(sanitizeErrorText(error.message), 'BACKUP_OPERATION_FAILED')
  }
  return new BackupServiceError(sanitizeErrorText(String(error)), 'BACKUP_OPERATION_FAILED')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function removeIfPresent(filePath: string | null): Promise<void> {
  if (!filePath) return
  try {
    await unlink(filePath)
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isBackupManifest(value: unknown): value is BackupManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Record<string, unknown>
  const source = manifest.source as Record<string, unknown> | undefined
  const schema = manifest.schema as Record<string, unknown> | undefined
  const postgres = manifest.postgres as Record<string, unknown> | undefined
  const encryption = manifest.encryption as Record<string, unknown> | undefined
  const archive = manifest.archive as Record<string, unknown> | undefined
  return manifest.format === BACKUP_FORMAT
    && manifest.formatVersion === BACKUP_FORMAT_VERSION
    && typeof manifest.operationId === 'string'
    && typeof manifest.actor === 'string'
    && manifest.scope === 'instance'
    && typeof manifest.applicationVersion === 'string'
    && typeof manifest.createdAt === 'string'
    && typeof manifest.completedAt === 'string'
    && source?.databaseFingerprint !== undefined
    && typeof source.databaseFingerprint === 'string'
    && typeof schema?.version === 'string'
    && typeof schema.fingerprintSha256 === 'string'
    && typeof schema.migrationCount === 'number'
    && typeof postgres?.pgDumpVersion === 'string'
    && encryption?.algorithm === 'aes-256-gcm'
    && typeof encryption.ivBase64 === 'string'
    && Buffer.from(encryption.ivBase64, 'base64').length === 12
    && typeof encryption.authTagBase64 === 'string'
    && Buffer.from(encryption.authTagBase64, 'base64').length === 16
    && typeof encryption.keyFingerprint === 'string'
    && typeof archive?.fileName === 'string'
    && typeof archive.checksumSha256 === 'string'
    && typeof archive.sizeBytes === 'number'
    && manifest.result === 'completed'
}

function readPackageVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
  )
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as Record<string, unknown>).version !== 'string') {
    throw new BackupServiceError('Could not read the Open Mercato package version.', 'APPLICATION_VERSION_UNAVAILABLE')
  }
  return (parsed as Record<string, string>).version
}
