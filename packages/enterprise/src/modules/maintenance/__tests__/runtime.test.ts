import { createFileMaintenanceStore } from '../lib/store/file'
import { activateState, mutateState } from '../lib/transitions'
import {
  createMaintenanceRequestGate,
  createMaintenanceWorkerGate,
  heartbeatOnce,
  refreshMaintenanceState,
  resetMaintenanceRuntimeForTests,
  startMaintenanceAgent,
  stopMaintenanceAgent,
} from '../lib/runtime'
import { evaluateDrain } from '../lib/drain'
import { resolveWidgetMode } from '../widgets/injection/maintenance-status/status'
import { GET as statusGet } from '../api/status/route'
import { makeConfig, makeTempDir } from './helpers'

async function setup() {
  const dir = makeTempDir()
  const store = createFileMaintenanceStore(dir)
  const runtime = resetMaintenanceRuntimeForTests({ config: makeConfig(dir, { heartbeatMs: 60_000 }), store })
  return { store, runtime }
}

afterEach(() => stopMaintenanceAgent())

describe('process heartbeat and accounting', () => {
  it('acknowledges the adopted gate revision together with in-flight counters', async () => {
    const { store, runtime } = await setup()
    await mutateState(store, (current, now) => ({ next: activateState(current, { startedBy: { source: 'cli', host: 'h' } }, now).next, result: undefined }))
    startMaintenanceAgent('worker')
    const gate = createMaintenanceRequestGate()
    const release = gate.onAdmitted!({ surface: 'api', method: 'GET', pathname: '/api/x', headers: new Headers(), cookies: { get: () => undefined } })
    await heartbeatOnce()
    let [record] = await store.listProcesses()
    const read = await store.readState()
    expect(record.ackedGateRevision).toBe(read.kind === 'ok' ? read.state.gateRevision : -1)
    expect(record.inflight).toBe(1)
    expect(record.kind).toBe('worker')
    if (typeof release === 'function') release()
    await heartbeatOnce()
    ;[record] = await store.listProcesses()
    expect(record.inflight).toBe(0)
    expect(runtime.agent?.kind).toBe('worker')
  })

  it('pauses workers while a window is active', async () => {
    const { store } = await setup()
    const gate = createMaintenanceWorkerGate()
    await refreshMaintenanceState(true)
    expect(gate.shouldPause({ kind: 'worker' })).toBe(false)
    await mutateState(store, (current, now) => ({ next: activateState(current, { startedBy: { source: 'cli', host: 'h' } }, now).next, result: undefined }))
    await refreshMaintenanceState(true)
    expect(gate.shouldPause({ kind: 'worker' })).toBe(true)
  })

  it('serves a minimal public status body', async () => {
    const { store } = await setup()
    let body = await (await statusGet()).json()
    expect(body).toEqual({ active: false, until: null, retryAfter: null, message: null })
    await mutateState(store, (current, now) => ({
      next: { ...activateState(current, { message: 'Back soon', reason: 'internal note', startedBy: { source: 'cli', host: 'h' } }, now).next },
      result: undefined,
    }))
    await refreshMaintenanceState(true)
    body = await (await statusGet()).json()
    expect(body).toEqual({ active: true, until: null, retryAfter: 300, message: 'Back soon' })
    expect(JSON.stringify(body)).not.toContain('internal note')
  })
})

describe('drain evaluation', () => {
  const now = new Date('2026-11-24T10:00:00Z')
  const base = { kind: 'web' as const, host: 'h', pid: 1, startedAt: now.toISOString(), loadedGeneration: null, heartbeatAt: now.toISOString() }

  it('treats stale records as missing evidence and requires zero in-flight work', () => {
    const report = evaluateDrain({
      processes: [
        { ...base, processId: 'a', ackedGateRevision: 5, inflight: 0 },
        { ...base, processId: 'b', ackedGateRevision: 5, inflight: 2 },
        { ...base, processId: 'c', ackedGateRevision: 5, inflight: 0, heartbeatAt: '2026-11-24T09:00:00Z' },
      ],
      targetRevision: 5,
      expected: { web: 3, worker: 0, scheduler: 0 },
      now,
      heartbeatMs: 5000,
    })
    expect(report.drained).toBe(false)
    expect(report.outstanding.map((entry) => entry.processId)).toEqual(['b'])
    expect(report.missing).toEqual([{ kind: 'web', expected: 3, seen: 2 }])
  })
})

describe('admin widget mode', () => {
  const active = { active: true, until: null, retryAfter: 300, message: null }
  it('shows the bypass banner when the page loads during a window and the overlay when a window starts later', () => {
    expect(resolveWidgetMode(null, active)).toBe('bypass-banner')
    expect(resolveWidgetMode(null, { ...active, active: false })).toBe('hidden')
    expect(resolveWidgetMode('hidden', active)).toBe('overlay')
    expect(resolveWidgetMode('overlay', { ...active, active: false })).toBe('hidden')
  })
})
