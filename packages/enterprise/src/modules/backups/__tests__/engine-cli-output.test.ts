import { runBackupCli } from '../lib/engine/cli/main'
test('an early CLI refusal emits only existing-schema NDJSON progress and one unchanged JSON result', async () => {
  const previous = process.env.OM_ENABLE_ENTERPRISE_MODULES
  delete process.env.OM_ENABLE_ENTERPRISE_MODULES
  const stdout: string[] = [], stderr: string[] = []
  try {
    expect(await runBackupCli(['status', '/generated/missing', '--json', '--progress', 'json'], { stdout: text => stdout.push(text), stderr: text => stderr.push(text) })).toBe(3)
    expect(stdout).toHaveLength(1); expect(JSON.parse(stdout[0])).toMatchObject({ schemaVersion: 1, status: 'refused', error: { code: 'BACKUP_ENTERPRISE_RIGHTS_REQUIRED' } })
    expect(stderr).toHaveLength(1); expect(JSON.parse(stderr[0])).toMatchObject({ schemaVersion: 1, type: 'phase.changed', phase: 'backup.refused', entity: expect.stringContaining('BACKUP_ENTERPRISE_RIGHTS_REQUIRED'), rowsDone: '0', bytesDone: '0', chunksDone: 0 })
    expect(stderr[0]).not.toContain('\u001b')
  } finally { if (previous === undefined) delete process.env.OM_ENABLE_ENTERPRISE_MODULES; else process.env.OM_ENABLE_ENTERPRISE_MODULES = previous }
})
