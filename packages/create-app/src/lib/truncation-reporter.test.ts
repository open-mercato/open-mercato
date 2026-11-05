import assert from 'node:assert/strict'
import test from 'node:test'
import reportTruncation from '../../scripts/report-truncation.mjs'

type SummaryEvent = {
  type: string
  data: { file?: string; counts: Record<string, number> }
}

async function collect(events: SummaryEvent[]): Promise<string> {
  const source = (async function* () {
    for (const event of events) yield event
  })()
  let output = ''
  for await (const chunk of reportTruncation(source)) output += chunk
  return output
}

// The counts shape is what node:test emits on its run-level `test:summary` event; per-file
// summaries carry `file`, the run-level one does not.
function summary(counts: Partial<Record<string, number>>, file?: string): SummaryEvent {
  return {
    type: 'test:summary',
    data: { file, counts: { tests: 0, failed: 0, passed: 0, cancelled: 0, skipped: 0, todo: 0, ...counts } },
  }
}

test('a truncated run is reported as truncated, not as failing tests', async () => {
  const output = await collect([summary({ tests: 287, passed: 169, failed: 0, cancelled: 27 })])

  assert.match(output, /TRUNCATED/)
  assert.match(output, /27 test file\(s\) were cancelled/)
  assert.match(output, /No assertion failed here/)
  assert.match(output, /yarn workspace create-mercato-app test/)
})

test('a truncated run that also has real failures points at the failures first', async () => {
  const output = await collect([summary({ tests: 287, passed: 169, failed: 3, cancelled: 27 })])

  assert.match(output, /TRUNCATED/)
  assert.match(output, /Fix the assertion failure\(s\) above first/)
})

test('a complete run stays silent', async () => {
  const output = await collect([summary({ tests: 461, passed: 456, failed: 0, cancelled: 0 })])

  assert.equal(output, '')
})

test('per-file summaries are ignored so one banner is printed per run', async () => {
  const output = await collect([
    summary({ tests: 1, passed: 0, cancelled: 1 }, '/repo/packages/create-app/src/lib/a.test.ts'),
    summary({ tests: 1, passed: 0, cancelled: 1 }, '/repo/packages/create-app/src/lib/b.test.ts'),
    summary({ tests: 2, passed: 0, cancelled: 2 }),
  ])

  assert.equal(output.match(/TRUNCATED/g)?.length, 1)
})
