import { createRotationPresentation } from '../presentation'
import type { RotationProtectionContext } from '@open-mercato/shared/lib/encryption/rotationProtection'
import type { VerificationResult } from '../verifier'

const context = { tenantId: 'tenant', organizationId: 'organization' } as RotationProtectionContext
const translate = (_key: string, fallback: string) => fallback
const result: VerificationResult = { schemaVersion: 1, runId: 'verification', status: 'passed', expectedRows: '2', comparedRows: '2', expectedFields: '12', comparedFields: '12', expectedBytes: '1251', comparedBytes: '1251', durationMs: 92 }

function fixture(environment: NodeJS.ProcessEnv, tty = false, columns = 100) {
  const writes: string[] = []
  const output = { isTTY: tty, columns, rows: 24, write(value: string | Uint8Array) { writes.push(String(value)); return true } }
  return { writes, presenter: createRotationPresentation(context, translate, environment, output) }
}

test('plain phases and final receipt show actual scope/counts and retained keys without decoration', () => {
  const { writes, presenter } = fixture({ TERM: 'dumb' }, true, 35)
  presenter.prepared('coordinator-run')
  for (const phase of ['recovery', 'recovery-verification', 'baseline', 'rotating', 'verification', 'finalizing'] as const) presenter.phase(phase)
  presenter.completed(result, '/trusted/report.json', '/recovery/backup')
  const text = writes.join('')
  expect(text).not.toContain('\u001b')
  expect(text).not.toMatch(/✅|🔧|❌/)
  expect(text).toContain('2/2')
  expect(text).toContain('12/12')
  expect(text).toContain('1251/1251')
  expect(text).toContain('/trusted/report.json')
  expect(text).toContain('/recovery/backup')
  expect(text).toContain('retain previous keys')
})

test('JSON notices and engine progress remain exclusively existing schemaVersion1 NDJSON events', () => {
  const { writes, presenter } = fixture({ OM_ROTATION_PROGRESS: 'json' }, true)
  presenter.prepared('coordinator-run')
  presenter.phase('verification')
  presenter.progress({ schemaVersion: 1, type: 'entity.progress', runId: 'coordinator-run', rowsDone: '1', rowsTotal: '2', rowsTotalExact: true, bytesDone: '12', chunksDone: 0, at: new Date().toISOString() })
  presenter.completed(result, '/trusted/report.json', '/recovery/backup')
  presenter.failed('Keep writers stopped.')
  for (const line of writes.join('').trim().split('\n')) {
    const event = JSON.parse(line)
    expect(event.schemaVersion).toBe(1)
    expect(['phase.changed', 'entity.progress']).toContain(event.type)
    expect(event).toHaveProperty('rowsDone')
    expect(line).not.toContain('\u001b')
  }
  expect(writes.join('')).toContain('OM_ROTATION_RESUME_ID=coordinator-run')
  const completed = writes.join('').trim().split('\n').map(line => JSON.parse(line)).filter(event => event.phase === 'rotation.completed')
  expect(completed.every(event => event.rowsDone === '2' && event.rowsTotal === '2' && event.rowsTotalExact === true && event.bytesDone === '1251')).toBe(true)
})

test.each(['', '1'])('NO_COLOR presence %j uses plain output even on a terminal', noColor => {
  const { writes, presenter } = fixture({ NO_COLOR: noColor, TERM: 'xterm' }, true)
  presenter.phase('recovery')
  presenter.failed('Keep previous keys.')
  expect(writes.join('')).not.toContain('\u001b')
  expect(writes.join('')).not.toMatch(/✅|🔧|❌/)
})

test('none suppresses live phases but retains actionable failure and explicit resume guidance', () => {
  const { writes, presenter } = fixture({ OM_ROTATION_PROGRESS: 'none' })
  presenter.phase('recovery')
  expect(writes).toHaveLength(0)
  presenter.prepared('coordinator-run')
  presenter.failed('Keep writers stopped.')
  expect(writes.join('')).toContain('Keep writers stopped.')
  expect(writes.join('')).toContain('OM_ROTATION_RESUME_ID=coordinator-run')
  expect(writes.join('')).not.toContain('--resume')
})

test('resuming validates the retained baseline without claiming a new capture', () => {
  const { writes, presenter } = fixture({ OM_ROTATION_RESUME_ID: 'coordinator-run' })
  presenter.phase('baseline')
  expect(writes.join('')).toContain('Validate the retained verification baseline')
  expect(writes.join('')).not.toContain('Capture verification baseline')
})
