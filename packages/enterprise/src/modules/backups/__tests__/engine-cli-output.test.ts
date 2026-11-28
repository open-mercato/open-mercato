import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { runBackupCli } from '../lib/engine/cli/main'
import { getLoggerExtension, registerLoggerExtension, type LoggerExtensionRecord } from '@open-mercato/shared/lib/logger'
test('an early CLI refusal emits only existing-schema NDJSON progress and one unchanged JSON result', async () => {
  const previous = process.env.OM_ENABLE_ENTERPRISE_MODULES
  delete process.env.OM_ENABLE_ENTERPRISE_MODULES
  const stdout: string[] = [], stderr: string[] = []
  const records: LoggerExtensionRecord[] = []
  const previousExtension = getLoggerExtension()
  const dispose = registerLoggerExtension({ enrich: previousExtension?.enrich, emit: record => { records.push(record); previousExtension?.emit?.(record) } })
  try {
    expect(await runBackupCli(['status', '/generated/missing', '--json', '--progress', 'json'], { stdout: text => stdout.push(text), stderr: text => stderr.push(text) })).toBe(3)
    expect(stdout).toHaveLength(1); expect(JSON.parse(stdout[0])).toMatchObject({ schemaVersion: 1, status: 'refused', error: { code: 'BACKUP_ENTERPRISE_RIGHTS_REQUIRED' } })
    expect(stderr).toHaveLength(2); expect(JSON.parse(stderr[1])).toMatchObject({ schemaVersion: 1, type: 'phase.changed', phase: 'backup.refused', entity: expect.stringContaining('BACKUP_ENTERPRISE_RIGHTS_REQUIRED'), rowsDone: '0', bytesDone: '0', chunksDone: 0 })
    expect(stderr.every(line => !line.includes('\u001b'))).toBe(true)
    expect(stderr.map(line => JSON.parse(line).phase)).toEqual(['backup.command.refused', 'backup.refused'])
    expect(records.map(record => record.namespace)).toEqual(['backups', 'telemetry'])
    expect(records[0]!.fields.code).toBe('BACKUP_ENTERPRISE_RIGHTS_REQUIRED'); expect(records[1]!.fields['error.code']).toBe('backups.command_failed')
  } finally { dispose(); if (previousExtension) registerLoggerExtension(previousExtension); if (previous === undefined) delete process.env.OM_ENABLE_ENTERPRISE_MODULES; else process.env.OM_ENABLE_ENTERPRISE_MODULES = previous }
})


jest.mock('node:readline/promises', () => ({ createInterface: jest.fn(() => { throw new Error('Unexpected interactive prompt') }) }))

test.each(['NO_COLOR', 'dumb'])('actual scoped error reporting on a %s TTY has no raw logger ANSI', async setting => {
  const priorRights = process.env.OM_ENABLE_ENTERPRISE_MODULES
  const priorColor = process.env.NO_COLOR, priorTerm = process.env.TERM
  const priorTty = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY')
  const raw: string[] = [], stderr: string[] = []
  const write = jest.spyOn(process.stderr, 'write').mockImplementation(chunk => { raw.push(String(chunk)); return true })
  try {
    delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    delete process.env.NO_COLOR; process.env.TERM = 'xterm'
    if (setting === 'NO_COLOR') process.env.NO_COLOR = ''
    else process.env.TERM = 'dumb'
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true })
    expect(await runBackupCli(['status', '/generated/missing'], { stdout: () => {}, stderr: text => stderr.push(text) })).toBe(3)
    expect(raw).toEqual([])
    expect(stderr.join('')).not.toContain('\u001b'); expect(stderr.join('')).not.toMatch(/[✅❌❗🔧]/u)
    expect(stderr.join('')).toContain('BACKUP_ENTERPRISE_RIGHTS_REQUIRED')
  } finally {
    write.mockRestore()
    if (priorTty) Object.defineProperty(process.stderr, 'isTTY', priorTty); else delete (process.stderr as unknown as Record<string, unknown>).isTTY
    if (priorRights === undefined) delete process.env.OM_ENABLE_ENTERPRISE_MODULES; else process.env.OM_ENABLE_ENTERPRISE_MODULES = priorRights
    if (priorColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = priorColor
    if (priorTerm === undefined) delete process.env.TERM; else process.env.TERM = priorTerm
  }
})

test('JSON progress on interactive stdin refuses unconfirmed plaintext backup without a human prompt or source access', async () => {
  const rights = ['OM_ENABLE_ENTERPRISE_MODULES', 'OM_ENABLE_ENTERPRISE_MODULES_BACKUPS', 'OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED'] as const
  const previous = rights.map(key => process.env[key])
  const priorTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const root = await mkdtemp(join(tmpdir(), 'backup-json-prompt-'))
  const stdout: string[] = [], stderr: string[] = []
  const open = jest.fn(), close = jest.fn()
  jest.mocked(createInterface).mockClear()
  try {
    for (const key of rights) process.env[key] = 'true'
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    const code = await runBackupCli(['create', '--source-service', 'fixture', '--output', join(root, 'out'), '--workspace', join(root, 'work'), '--no-encryption', '--json', '--progress', 'json'], { stdout: text => stdout.push(text), stderr: text => stderr.push(text), sourceFactory: () => ({ open, close }) })
    expect(code).toBe(3); expect(JSON.parse(stdout[0])).toMatchObject({ error: { code: 'BACKUP_UNENCRYPTED_REFUSED' } })
    expect(jest.mocked(createInterface)).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
    expect(stderr).toHaveLength(2); for (const line of stderr) expect(JSON.parse(line)).toMatchObject({ schemaVersion: 1, type: 'phase.changed', rowsDone: '0' })
    expect(await readdir(root)).toEqual([])
  } finally {
    if (priorTty) Object.defineProperty(process.stdin, 'isTTY', priorTty); else delete (process.stdin as unknown as Record<string, unknown>).isTTY
    rights.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index] })
    await rm(root, { recursive: true, force: true })
  }
})

test('configure is a read-only plan without rights, key creation, database access or implicit provisioning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backup-configure-'))
  const previous = process.env.OM_ENABLE_ENTERPRISE_MODULES
  const stdout: string[] = [], stderr: string[] = []
  const sourceFactory = jest.fn(), targetFactory = jest.fn()
  try {
    delete process.env.OM_ENABLE_ENTERPRISE_MODULES
    const code = await runBackupCli(['configure', '--json', '--progress', 'json', '--output', join(root, 'archive'), '--workspace', join(root, 'workspace'), '--binaries-dir', join(root, 'missing-clients')], { stdout: text => stdout.push(text), stderr: text => stderr.push(text), sourceFactory, targetFactory })
    expect(code).toBe(0)
    expect(stdout).toHaveLength(1); expect(stderr).toEqual([])
    expect(JSON.parse(stdout[0])).toMatchObject({ schemaVersion: 1, command: 'configure', status: 'completed', assurance: 'configuration-plan-only', paths: { backupOutput: join(root, 'archive'), backupWorkspace: join(root, 'workspace') }, provenance: { backupOutput: 'argument', backupWorkspace: 'argument' }, missingPrerequisites: expect.arrayContaining([{ code: 'RECOVERY_POSTGRES_CLIENTS_REQUIRED', field: 'binariesDir', path: join(root, 'missing-clients') }]) })
    expect(sourceFactory).not.toHaveBeenCalled(); expect(targetFactory).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
    expect(process.env.OM_ENABLE_ENTERPRISE_MODULES).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OM_ENABLE_ENTERPRISE_MODULES; else process.env.OM_ENABLE_ENTERPRISE_MODULES = previous
    await rm(root, { recursive: true, force: true })
  }
})


test('configure preserves the application wrapper refusal of machine JSON', async () => {
  const stdout: string[] = []
  expect(await runBackupCli(['configure', '--json', '--progress', 'json'], { appWrapper: true, stdout: value => stdout.push(value), stderr: () => {} })).toBe(2)
  expect(JSON.parse(stdout[0]).error.code).toBe('BACKUP_USE_STANDALONE_FOR_JSON')
})
