import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { publishRotationReport } from '../report'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rotation-receipt-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const recovery = { artifactPath: '/isolated/backup', databaseBinding: 'database', digest: 'a'.repeat(64), consistency: 'quiesced' as const, encrypted: true as const }
const result = () => ({ schemaVersion: 1 as const, runId: randomUUID(), status: 'passed' as const, expectedRows: '10', comparedRows: '10', expectedFields: '20', comparedFields: '20', durationMs: 1 })
test('equivalent durable receipts are idempotent across fresh verification durations', async () => {
  const record = result(); const path = join(directory, 'report.json')
  await publishRotationReport(path, record, recovery)
  await publishRotationReport(path, { ...record, durationMs: 42 }, recovery)
  expect(JSON.parse(await readFile(path, 'utf8')).durationMs).toBe(1)
})
test.each(['counts', 'backup'])('conflicting %s cannot overwrite a completed receipt', async (which) => {
  const record = result(); const path = join(directory, 'report.json')
  await publishRotationReport(path, record, recovery)
  await expect(publishRotationReport(path, which === 'counts' ? { ...record, comparedRows: '9' } : record, which === 'backup' ? { ...recovery, digest: 'b'.repeat(64) } : recovery)).rejects.toThrow('ROTATION_REPORT_CONFLICT')
})
