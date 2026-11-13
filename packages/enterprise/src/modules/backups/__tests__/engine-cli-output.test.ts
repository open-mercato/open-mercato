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
