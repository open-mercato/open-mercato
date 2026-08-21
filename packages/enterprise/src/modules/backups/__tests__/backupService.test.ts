import { createHash } from 'node:crypto'
import { access, appendFile, chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BackupService,
  BackupServiceError,
  readBackupManifest,
} from '../lib/backupService'
import { readAuditReceipt, verifyAuditReceipt } from '../lib/auditReceipts'
import { ErasureManifestService, resolveErasureManifestDirectory } from '../lib/erasureManifest'

const ENCRYPTION_KEY = Buffer.alloc(32, 7)
const AUDIT_KEY = Buffer.alloc(32, 9)
const DATABASE_URL = 'postgres://backup_user:secret@127.0.0.1:5432/source'
const RESTORE_DATABASE_URL = 'postgres://restore_user:other-secret@127.0.0.1:5432/restored'
const DUMP_PAYLOAD = 'FAKE_CUSTOM_FORMAT_DATABASE_ARCHIVE_with-data'

describe('BackupService', () => {
  let testRoot: string
  let backupDirectory: string
  let auditDirectory: string
  let toolDirectory: string
  let restoreCapturePath: string
  let dumpArgsCapturePath: string
  let restoreArgsCapturePath: string
  let idSequence: number
  let timeSequence: number

  beforeEach(async () => {
    testRoot = await mkdtemp(path.join(os.tmpdir(), 'om-backups-'))
    backupDirectory = path.join(testRoot, 'archives')
    auditDirectory = path.join(testRoot, 'audit')
    toolDirectory = path.join(testRoot, 'bin')
    restoreCapturePath = path.join(testRoot, 'restored.dump')
    dumpArgsCapturePath = path.join(testRoot, 'pg-dump-args.json')
    restoreArgsCapturePath = path.join(testRoot, 'pg-restore-args.json')
    idSequence = 0
    timeSequence = 0
    await writeFakeTools(toolDirectory)
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('creates an encrypted archive, schema manifest, checksum, and signed receipts', async () => {
    const service = createService()
    const result = await service.backup({ label: 'nightly-test' })

    const encrypted = await readFile(result.archivePath)
    expect(encrypted.includes(Buffer.from(DUMP_PAYLOAD))).toBe(false)
    expect(result.manifest.actor).toBe('operator@example.com')
    expect(result.manifest.scope).toBe('instance')
    expect(result.manifest.label).toBe('nightly-test')
    expect(result.manifest.schema.migrationCount).toBe(2)
    expect(result.manifest.schema.version).toContain('Migration202608210002')
    expect(result.manifest.archive.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.manifest.postgres.pgDumpVersion).toBe('16.4')
    const dumpArgs = JSON.parse(await readFile(dumpArgsCapturePath, 'utf8')) as string[]
    expect(dumpArgs.join(' ')).not.toContain('postgres://')
    expect(dumpArgs.join(' ')).not.toContain('secret')

    const persisted = await readBackupManifest(result.manifestPath)
    expect(persisted).toEqual(result.manifest)
    const receiptNames = await readdir(auditDirectory)
    expect(receiptNames).toHaveLength(2)
    const receipts = await Promise.all(
      receiptNames.map((name) => readAuditReceipt(path.join(auditDirectory, name))),
    )
    expect(receipts.map((receipt) => receipt.phase).sort()).toEqual(['completed', 'started'])
    expect(receipts.every((receipt) => receipt.backupOperationId === result.operationId)).toBe(true)
    expect(receipts.every((receipt) => verifyAuditReceipt(receipt, AUDIT_KEY))).toBe(true)
  })

  it('verifies a backup without writing to a database and rejects corruption', async () => {
    const service = createService()
    const backup = await service.backup()

    const verified = await service.verify(backup.operationId)
    expect(verified.dryRun).toBe(true)
    expect(verified.targetDatabaseFingerprint).toBeNull()

    await appendFile(backup.archivePath, 'corruption')
    await expect(service.verify(backup.operationId)).rejects.toMatchObject<Partial<BackupServiceError>>({
      code: 'CHECKSUM_MISMATCH',
    })
  })

  it('reports erasures that must be reapplied after restore', async () => {
    const service = createService()
    const backup = await service.backup()
    const erasureManifest = new ErasureManifestService(resolveErasureManifestDirectory(
      backupDirectory,
      { OM_ERASURE_MANIFEST_DIRECTORY: '' },
    ))
    await erasureManifest.append({
      requestId: 'erasure-after-backup',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      subjectKind: 'auth:user',
      subjectId: 'user-1',
      executedAt: new Date('2026-08-21T10:00:10.000Z'),
    })

    const result = await service.verify(backup.operationId)

    expect(result.pendingErasureActions).toHaveLength(1)
    expect(result.pendingErasureActions[0]?.requestId).toBe('erasure-after-backup')
  })

  it('restores the decrypted archive only after force and database-name confirmation', async () => {
    const service = createService({ restoreDatabaseUrl: RESTORE_DATABASE_URL })
    const backup = await service.backup()

    await expect(service.restore({
      reference: backup.operationId,
      dryRun: false,
      confirmDatabase: 'restored',
    })).rejects.toMatchObject<Partial<BackupServiceError>>({ code: 'RESTORE_FORCE_REQUIRED' })

    await expect(service.restore({
      reference: backup.operationId,
      dryRun: false,
      force: true,
      confirmDatabase: 'wrong',
    })).rejects.toMatchObject<Partial<BackupServiceError>>({ code: 'RESTORE_CONFIRMATION_REQUIRED' })

    const restored = await service.restore({
      reference: backup.operationId,
      dryRun: false,
      force: true,
      confirmDatabase: 'restored',
    })
    expect(restored.dryRun).toBe(false)
    expect(await readFile(restoreCapturePath, 'utf8')).toBe(DUMP_PAYLOAD)
    const restoreArgs = JSON.parse(await readFile(restoreArgsCapturePath, 'utf8')) as string[]
    expect(restoreArgs).toContain('--dbname=restored')
    expect(restoreArgs.join(' ')).not.toContain('postgres://')
    expect(restoreArgs.join(' ')).not.toContain('other-secret')

    const receiptNames = await readdir(auditDirectory)
    const restoreReceipts = await Promise.all(
      receiptNames
        .filter((name) => name.includes('.restore.'))
        .map((name) => readAuditReceipt(path.join(auditDirectory, name))),
    )
    expect(restoreReceipts.map((receipt) => receipt.phase).sort()).toEqual(['completed', 'started'])
    expect(restoreReceipts.every((receipt) => receipt.backupOperationId === backup.operationId)).toBe(true)
    expect(restoreReceipts.every((receipt) => receipt.targetDatabaseFingerprint !== null)).toBe(true)
  })

  it('does not use the restore force flag to bypass application version checks', async () => {
    const sourceService = createService({ restoreDatabaseUrl: RESTORE_DATABASE_URL })
    const backup = await sourceService.backup()
    const newerService = createService({
      restoreDatabaseUrl: RESTORE_DATABASE_URL,
      applicationVersion: '0.7.0',
    })

    await expect(newerService.restore({
      reference: backup.operationId,
      dryRun: false,
      force: true,
      confirmDatabase: 'restored',
    })).rejects.toMatchObject<Partial<BackupServiceError>>({ code: 'APPLICATION_VERSION_MISMATCH' })
  })

  it('authenticates the whole archive before opening a restore stream', async () => {
    const service = createService({ restoreDatabaseUrl: RESTORE_DATABASE_URL })
    const backup = await service.backup()
    await appendFile(backup.archivePath, 'tampered')
    const tamperedArchive = await readFile(backup.archivePath)
    const tamperedManifest = {
      ...backup.manifest,
      archive: {
        ...backup.manifest.archive,
        checksumSha256: createHash('sha256').update(tamperedArchive).digest('hex'),
        sizeBytes: tamperedArchive.length,
      },
    }
    await writeFile(backup.manifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, 'utf8')

    await expect(service.restore({
      reference: backup.operationId,
      dryRun: false,
      force: true,
      confirmDatabase: 'restored',
    })).rejects.toMatchObject<Partial<BackupServiceError>>({ code: 'ARCHIVE_AUTHENTICATION_FAILED' })
    await expect(access(restoreCapturePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  function createService(overrides: {
    restoreDatabaseUrl?: string
    applicationVersion?: string
  } = {}): BackupService {
    return new BackupService({
      databaseUrl: DATABASE_URL,
      restoreDatabaseUrl: overrides.restoreDatabaseUrl,
      backupDirectory,
      auditDirectory,
      encryptionKey: ENCRYPTION_KEY,
      auditHmacKey: AUDIT_KEY,
      actor: 'operator@example.com',
      applicationVersion: overrides.applicationVersion ?? '0.6.7',
      environment: {
        ...process.env,
        FAKE_DUMP_PAYLOAD: DUMP_PAYLOAD,
        FAKE_DUMP_ARGS_CAPTURE: dumpArgsCapturePath,
        FAKE_RESTORE_CAPTURE: restoreCapturePath,
        FAKE_RESTORE_ARGS_CAPTURE: restoreArgsCapturePath,
        FAKE_TARGET_TABLE_COUNT: '0',
      },
      tools: {
        pgDump: path.join(toolDirectory, 'pg_dump'),
        pgRestore: path.join(toolDirectory, 'pg_restore'),
        psql: path.join(toolDirectory, 'psql'),
      },
      now: () => new Date(Date.UTC(2026, 7, 21, 10, 0, timeSequence++)),
      randomId: () => `id-${++idSequence}`,
    })
  }
})

async function writeFakeTools(directory: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeExecutable(path.join(directory, 'pg_dump'), `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write('pg_dump (PostgreSQL) 16.4\\n')
} else {
  require('node:fs').writeFileSync(process.env.FAKE_DUMP_ARGS_CAPTURE, JSON.stringify(process.argv.slice(2)))
  process.stdout.write(process.env.FAKE_DUMP_PAYLOAD || '')
}
`),
    writeExecutable(path.join(directory, 'pg_restore'), `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('--version')) {
  process.stdout.write('pg_restore (PostgreSQL) 16.4\\n')
  process.exit(0)
}
fs.writeFileSync(process.env.FAKE_RESTORE_ARGS_CAPTURE, JSON.stringify(process.argv.slice(2)))
const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  const payload = Buffer.concat(chunks)
  if (process.argv.includes('--list')) {
    process.stdout.write('archive-list-ok\\n')
    return
  }
  fs.writeFileSync(process.env.FAKE_RESTORE_CAPTURE, payload)
})
`),
    writeExecutable(path.join(directory, 'psql'), `#!/usr/bin/env node
const query = process.argv[process.argv.length - 1] || ''
if (query.includes('pg_catalog.pg_tables')) {
  process.stdout.write((process.env.FAKE_TARGET_TABLE_COUNT || '0') + '\\n')
} else if (query.includes('information_schema.tables')) {
  process.stdout.write('mikro_orm_migrations_auth\\n')
} else if (query.includes('SELECT name')) {
  process.stdout.write('Migration202608210001\\nMigration202608210002\\n')
}
`),
  ])
}

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, source, 'utf8')
  await chmod(filePath, 0o700)
}
