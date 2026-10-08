import { createMemoryLogSource, createMemoryStore, type MemoryLogRow } from './memoryProjection'
import { testRegistry, TENANT_ID, ORG_ID, USER_ID } from '../../process/__tests__/processTestSupport'
import type { ProcessRegistrySnapshot } from '../../process/registry'
import type { XrayIngestDeps } from '../ingest'
import type { XraySettingsSnapshot } from '../settings'

const enqueueXrayBackfill = jest.fn(async () => undefined)
const enqueueXrayIngest = jest.fn(async () => undefined)
const ensureXrayIngestSchedule = jest.fn(async () => true)
const isXrayIngestEnabled = jest.fn(async () => true)
const loadXraySettings = jest.fn(async (): Promise<XraySettingsSnapshot> => settings())
let registry: ProcessRegistrySnapshot = testRegistry()
let memory = createMemoryStore('2026-10-08T10:00:00.000000Z')
let logRows: MemoryLogRow[] = []
const ingestDeps = jest.fn(async (): Promise<{ deps: XrayIngestDeps; em: unknown }> => ({
  em: {},
  deps: {
    store: memory.store,
    logSource: createMemoryLogSource(logRows),
    registry,
    pseudonymizer: { mode: 'tenant_key', fingerprint: 'tk1:test-key', pseudonymize: (id: string) => `tk1:${id}` },
    resolveActorDimensions: async () => new Map(),
    redactedFields: new Set<string>(),
    owner: 'worker',
  },
}))

jest.mock('../queue', () => {
  const actual = jest.requireActual('../queue')
  return {
    ...actual,
    enqueueXrayBackfill: (...args: unknown[]) => enqueueXrayBackfill(...(args as [])),
    enqueueXrayIngest: (...args: unknown[]) => enqueueXrayIngest(...(args as [])),
    ensureXrayIngestSchedule: (...args: unknown[]) => ensureXrayIngestSchedule(...(args as [])),
  }
})

jest.mock('../killSwitch', () => ({
  isXrayIngestEnabled: (...args: unknown[]) => isXrayIngestEnabled(...(args as [])),
}))

jest.mock('../settings', () => {
  const actual = jest.requireActual('../settings')
  return { ...actual, loadXraySettings: (...args: unknown[]) => loadXraySettings(...(args as [])) }
})

jest.mock('../../process/registry', () => {
  const actual = jest.requireActual('../../process/registry')
  return { ...actual, getProcessRegistry: () => registry }
})

jest.mock('../runtime', () => {
  const actual = jest.requireActual('../runtime')
  return {
    ...actual,
    createXrayStore: () => memory.store,
    createXrayIngestDeps: (...args: unknown[]) => ingestDeps(...(args as [])),
    createLeaseOwner: () => 'cli-owner',
  }
})

const createActorPseudonymizer = jest.fn(async () => ({ mode: 'tenant_key', fingerprint: 'tk1:test-key', pseudonymize: (id: string) => `tk1:${id}` }))

jest.mock('../pseudonym', () => {
  const actual = jest.requireActual('../pseudonym')
  return { ...actual, createActorPseudonymizer: (...args: unknown[]) => createActorPseudonymizer(...(args as [])) }
})

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import {
  XrayErasureIncompleteError,
  eraseXrayActor,
  failAbandonedXrayScan,
  rebuildXrayProjection,
  runXrayBackfillJob,
  runXrayIngestJob,
  startXrayBackfill,
} from '../jobs'
import { buildProcessRegistrySnapshot } from '../../process/registry'

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const LABELS = { userId: USER_ID, name: 'Backfill', description: 'Backfill history' }

function projectedEvent(actorPseudonym: string) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    processKey: 'test.deal',
    caseKind: 'test.deal',
    caseId: 'cccccccc-0000-4000-8000-000000000001',
    activityKey: 'status:won',
    activityKind: 'stage',
    occurredAt: '2026-10-08T09:00:00.000000Z',
    sourceLogId: 'abababab-0000-4000-8000-000000000001',
    seq: 0,
    actorPseudonym,
    actorRoleIds: null,
    actorTeamId: null,
    causeKind: 'user',
    causeId: null,
    viaSyncRun: false,
    followupField: null as string | null,
    followupValue: null as string | null,
    voided: false,
    voidedByLogId: null,
  }
}

function settings(overrides: Partial<XraySettingsSnapshot> = {}): XraySettingsSnapshot {
  return {
    id: null,
    updatedAt: null,
    enabled: true,
    retentionDays: 30,
    kAnonymity: 10,
    debounceSeconds: 120,
    individualsEnabled: false,
    conformanceWorkflowId: null,
    activityStepMap: null,
    ...overrides,
  }
}

function progressService() {
  return {
    createJob: jest.fn(async () => ({ id: 'dddddddd-0000-4000-8000-000000000001' })),
    startJob: jest.fn(async () => ({})),
    updateProgress: jest.fn(async () => ({})),
    completeJob: jest.fn(async () => ({})),
    failJob: jest.fn(async () => ({})),
    markCancelled: jest.fn(async () => ({})),
    isCancellationRequested: jest.fn(async () => false),
    touchJobHeartbeat: jest.fn(async () => undefined),
  }
}

function container(progress: ReturnType<typeof progressService> | null) {
  return {
    resolve: (name: string): unknown => {
      if (name === 'em') return { fork: () => ({}) }
      if (name === 'progressService' && progress) return progress
      throw new Error(`[internal] unexpected service ${name}`)
    },
  }
}

beforeEach(() => {
  memory = createMemoryStore('2026-10-08T10:00:00.000000Z')
  logRows = []
  registry = testRegistry()
  jest.clearAllMocks()
  isXrayIngestEnabled.mockResolvedValue(true)
  loadXraySettings.mockResolvedValue(settings())
})

describe('runXrayIngestJob', () => {
  it('skips without declarations, with the kill switch off or with ingest disabled in settings', async () => {
    registry = buildProcessRegistrySnapshot([], [])
    expect(await runXrayIngestJob(container(null), SCOPE)).toEqual({ status: 'no_processes' })
    registry = testRegistry()
    isXrayIngestEnabled.mockResolvedValueOnce(false)
    expect(await runXrayIngestJob(container(null), SCOPE)).toEqual({ status: 'disabled' })
    loadXraySettings.mockResolvedValueOnce(settings({ enabled: false }))
    expect(await runXrayIngestJob(container(null), SCOPE)).toEqual({ status: 'disabled' })
    expect(ingestDeps).not.toHaveBeenCalled()
    expect(memory.state.cursors).toEqual([])
  })

  it('runs a slice and enqueues a due reconciliation scan', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    memory.state.cursors[0].lastReconciledAt = '2026-10-06T00:00:00.000000Z'
    const result = await runXrayIngestJob(container(null), SCOPE)
    expect(result.status).toBe('caught_up')
    const cursor = memory.state.cursors[0]
    expect(cursor.scanId).toEqual(expect.any(String))
    expect(enqueueXrayBackfill).toHaveBeenCalledWith({ scope: SCOPE, scanId: cursor.scanId, chainId: cursor.scanChainId, progressJobId: null })
  })

  it('hands a stalled scan to a new chain and records sanitized ingest errors before rethrowing', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    const cursor = memory.state.cursors[0]
    await memory.store.startScan(cursor, { scanId: 'eeeeeeee-0000-4000-8000-000000000001', chainId: 'eeeeeeee-0000-4000-8000-0000000000c1', kind: 'backfill', from: null, until: '2026-10-08T09:00:00.000000Z', progressJobId: 'job-1' })
    cursor.scanUpdatedAt = '2026-10-08T09:00:00.000000Z'
    await runXrayIngestJob(container(null), SCOPE)
    expect(cursor.scanChainId).not.toBe('eeeeeeee-0000-4000-8000-0000000000c1')
    expect(enqueueXrayBackfill).toHaveBeenCalledWith({ scope: SCOPE, scanId: 'eeeeeeee-0000-4000-8000-000000000001', chainId: cursor.scanChainId, progressJobId: 'job-1' })

    const databaseError = Object.assign(new Error('duplicate key value (secret@example.com)'), { name: 'DatabaseError', code: '23505' })
    const failing = jest.spyOn(memory.store, 'now').mockRejectedValueOnce(databaseError)
    await expect(runXrayIngestJob(container(null), SCOPE)).rejects.toBe(databaseError)
    expect(cursor.lastError).toBe('DatabaseError (SQLSTATE 23505)')
    failing.mockRestore()

    ingestDeps.mockImplementationOnce(async () => {
      throw new Error('[internal] The tenant key for Process X-Ray actor pseudonyms is unavailable')
    })
    await expect(runXrayIngestJob(container(null), SCOPE)).rejects.toThrow('tenant key')
    expect(cursor.lastError).toBe('[internal] The tenant key for Process X-Ray actor pseudonyms is unavailable')
  })
})

describe('startXrayBackfill', () => {
  it('starts a progress-tracked scan over the retention window, supersedes the previous one and registers the schedule', async () => {
    const progress = progressService()
    const first = await startXrayBackfill(container(progress), SCOPE, LABELS)
    expect(first).toEqual({ ok: true, scanId: expect.any(String), chainId: expect.any(String), progressJobId: 'dddddddd-0000-4000-8000-000000000001', scheduleRegistered: true })
    const cursor = memory.state.cursors[0]
    expect(cursor).toEqual(expect.objectContaining({
      status: 'backfilling',
      scanKind: 'backfill',
      scanFrom: '2026-09-08T10:00:00.000000Z',
      scanUntil: '2026-10-08T10:00:00.000000Z',
      scanProgressJobId: 'dddddddd-0000-4000-8000-000000000001',
    }))
    expect(progress.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'insights.xray.backfill', name: 'Backfill', cancellable: true }),
      { tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID },
    )
    expect(enqueueXrayBackfill).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID },
      scanId: first.ok ? first.scanId : '',
      chainId: first.ok ? first.chainId : '',
      progressJobId: 'dddddddd-0000-4000-8000-000000000001',
    })
    expect(cursor.scanChainId).toBe(first.ok ? first.chainId : '')
    progress.createJob.mockResolvedValueOnce({ id: 'dddddddd-0000-4000-8000-000000000002' })
    const second = await startXrayBackfill(container(progress), SCOPE, { ...LABELS, enqueue: false })
    expect(second.ok && second.scanId !== (first.ok ? first.scanId : '')).toBe(true)
    expect(progress.markCancelled).toHaveBeenCalledWith('dddddddd-0000-4000-8000-000000000001', expect.objectContaining({ tenantId: TENANT_ID }))
    expect(enqueueXrayBackfill).toHaveBeenCalledTimes(1)
  })

  it('refuses when ingest is disabled or nothing is declared, and starts over outdated contracts (the scan rebuilds them)', async () => {
    isXrayIngestEnabled.mockResolvedValueOnce(false)
    expect(await startXrayBackfill(container(null), SCOPE, LABELS)).toEqual({ ok: false, reason: 'disabled' })
    registry = buildProcessRegistrySnapshot([], [])
    expect(await startXrayBackfill(container(null), SCOPE, LABELS)).toEqual({ ok: false, reason: 'no_processes' })
    registry = testRegistry()
    await memory.store.ensureCursor(SCOPE, 60_000)
    memory.state.cursors[0].contractHashes = { 'test.deal': 'old-hash' }
    const started = await startXrayBackfill(container(null), SCOPE, LABELS)
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('[internal] backfill should start')
    expect(await runXrayBackfillJob(container(null), { scope: { ...SCOPE, userId: USER_ID }, scanId: started.scanId, chainId: started.chainId, progressJobId: null })).toBe('completed')
    expect(memory.state.cursors[0]).toEqual(expect.objectContaining({
      contractHashes: { 'test.deal': expect.any(String) },
      contractChange: { changed: ['test.deal'], added: [], removed: [] },
      pendingRebuildKeys: ['test.deal'],
    }))
    expect(memory.state.cursors[0].contractHashes?.['test.deal']).not.toBe('old-hash')
  })
})

describe('runXrayBackfillJob', () => {
  async function started(progress: ReturnType<typeof progressService>) {
    const result = await startXrayBackfill(container(progress), SCOPE, LABELS)
    if (!result.ok) throw new Error('[internal] backfill should start')
    return { scope: { ...SCOPE, userId: USER_ID }, scanId: result.scanId, chainId: result.chainId, progressJobId: result.progressJobId }
  }

  it('completes the scan and the progress job', async () => {
    const progress = progressService()
    const payload = await started(progress)
    expect(await runXrayBackfillJob(container(progress), payload)).toBe('completed')
    expect(progress.startJob).toHaveBeenCalled()
    expect(progress.completeJob).toHaveBeenCalledWith(payload.progressJobId, { resultSummary: { processed: 0, scanId: payload.scanId } }, expect.any(Object))
    expect(memory.state.cursors[0].scanId).toBeNull()
  })

  it('cancels on request and when ingest gets disabled', async () => {
    const progress = progressService()
    const payload = await started(progress)
    progress.isCancellationRequested.mockResolvedValueOnce(true)
    expect(await runXrayBackfillJob(container(progress), payload)).toBe('cancelled')
    expect(progress.markCancelled).toHaveBeenCalledWith(payload.progressJobId, expect.any(Object))
    expect(memory.state.cursors[0].scanId).toBeNull()

    const again = await started(progress)
    isXrayIngestEnabled.mockResolvedValueOnce(false)
    expect(await runXrayBackfillJob(container(progress), again)).toBe('disabled')
    expect(memory.state.cursors[0].scanId).toBeNull()
  })

  it('re-enqueues itself when the lease is busy and when the budget runs out', async () => {
    const progress = progressService()
    const payload = await started(progress)
    const cursor = memory.state.cursors[0]
    cursor.leaseOwner = 'other'
    cursor.leaseUntil = '2026-10-08T11:00:00.000000Z'
    cursor.scanUpdatedAt = '2026-10-08T09:00:00.000000Z'
    expect(await runXrayBackfillJob(container(progress), payload)).toBe('lease_busy')
    expect(progress.touchJobHeartbeat).toHaveBeenCalled()
    expect(cursor.scanUpdatedAt).toBe('2026-10-08T10:00:00.000000Z')
    expect(enqueueXrayBackfill).toHaveBeenLastCalledWith(payload, 5000)
    expect(await runXrayBackfillJob(container(progress), payload, { enqueueContinuation: false })).toBe('lease_busy')
    expect(enqueueXrayBackfill).toHaveBeenCalledTimes(2)
  })

  it('fails the progress job and rethrows so the queue retries from the persisted position', async () => {
    const progress = progressService()
    const payload = await started(progress)
    jest.spyOn(memory.store, 'acquireLease').mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: '08006' }))
    await expect(runXrayBackfillJob(container(progress), payload)).rejects.toThrow('connection reset')
    expect(progress.failJob).toHaveBeenCalledWith(payload.progressJobId, { errorMessage: 'Error (SQLSTATE 08006)' }, expect.any(Object))
    expect(memory.state.cursors[0].scanId).toBe(payload.scanId)
  })

  it('cancels the progress job of a superseded scan and clears an abandoned one', async () => {
    const progress = progressService()
    const payload = await started(progress)
    progress.createJob.mockResolvedValueOnce({ id: 'dddddddd-0000-4000-8000-000000000009' })
    await startXrayBackfill(container(progress), SCOPE, { ...LABELS, enqueue: false })
    progress.markCancelled.mockClear()
    expect(await runXrayBackfillJob(container(progress), payload)).toBe('superseded')
    expect(progress.markCancelled).toHaveBeenCalledWith(payload.progressJobId, expect.any(Object))

    const current = {
      ...payload,
      scanId: memory.state.cursors[0].scanId ?? '',
      chainId: memory.state.cursors[0].scanChainId ?? '',
      progressJobId: 'dddddddd-0000-4000-8000-000000000009',
    }
    await failAbandonedXrayScan(container(progress), { ...current, chainId: 'eeeeeeee-0000-4000-8000-0000000000ff' }, 'stale chain')
    expect(memory.state.cursors[0].scanId).toBe(current.scanId)
    await failAbandonedXrayScan(container(progress), current, 'job stalled more than allowable limit (secret)')
    expect(memory.state.cursors[0].scanId).toBeNull()
    expect(progress.failJob).toHaveBeenCalledWith(
      'dddddddd-0000-4000-8000-000000000009',
      { errorMessage: '[internal] The queue abandoned the X-Ray backfill job after its retries' },
      expect.any(Object),
    )
    expect(memory.state.cursors[0].lastError).not.toContain('secret')
  })

  it('drops a job of a replaced chain without touching the scan or its progress job', async () => {
    const progress = progressService()
    const payload = await started(progress)
    const stale = { ...payload, chainId: 'eeeeeeee-0000-4000-8000-0000000000aa' }
    expect(await runXrayBackfillJob(container(progress), stale)).toBe('stale_chain')
    expect(memory.state.cursors[0].scanId).toBe(payload.scanId)
    expect(progress.startJob).not.toHaveBeenCalled()
    expect(progress.markCancelled).not.toHaveBeenCalled()
    expect(enqueueXrayBackfill).toHaveBeenCalledTimes(1)
  })

  it('fails the scan when its organization was written under another pseudonym key', async () => {
    const progress = progressService()
    const payload = await started(progress)
    memory.state.cursors[0].actorKeyFingerprint = 'tk1:old-key'
    expect(await runXrayBackfillJob(container(progress), payload)).toBe('key_mismatch')
    expect(memory.state.cursors[0].scanId).toBeNull()
    expect(progress.failJob).toHaveBeenCalledWith(payload.progressJobId, { errorMessage: expect.stringContaining('another key') }, expect.any(Object))
  })

  it('backs off a scheduled reconciliation its chain gave up on', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    const cursor = memory.state.cursors[0]
    cursor.lastReconciledAt = '2026-10-06T00:00:00.000000Z'
    await runXrayIngestJob(container(null), SCOPE)
    const payload = { scope: SCOPE, scanId: cursor.scanId ?? '', chainId: cursor.scanChainId ?? '', progressJobId: null }
    await failAbandonedXrayScan(container(null), payload, 'stalled')
    expect(cursor).toEqual(expect.objectContaining({ scanId: null, lastReconciledAt: '2026-10-08T10:00:00.000000Z' }))
    enqueueXrayBackfill.mockClear()
    const next = await runXrayIngestJob(container(null), SCOPE)
    expect(next.status).toBe('caught_up')
    expect(enqueueXrayBackfill).not.toHaveBeenCalled()
  })
})

describe('rebuild and erasure', () => {
  it('clears the projection, resets the contracts for adoption and starts a backfill', async () => {
    await memory.store.ensureCursor(SCOPE, 60_000)
    Object.assign(memory.state.cursors[0], { contractHashes: { 'test.deal': 'old-hash' }, pendingRebuildKeys: ['test.deal'] })
    memory.state.events.push(projectedEvent(`tk1:${USER_ID}`))
    const result = await rebuildXrayProjection(container(progressService()), SCOPE, LABELS)
    expect(result.ok).toBe(true)
    expect(memory.state.events).toEqual([])
    expect(memory.state.cursors[0]).toEqual(expect.objectContaining({ contractHashes: null, pendingRebuildKeys: [], status: 'backfilling', scanKind: 'backfill' }))
  })

  it('leaves a full reconciliation due when the backfill of a rebuild fails to start', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    memory.state.events.push(projectedEvent(`tk1:${USER_ID}`))
    const progress = progressService()
    progress.createJob.mockRejectedValueOnce(new Error('progress store down'))
    await expect(rebuildXrayProjection(container(progress), SCOPE, LABELS)).rejects.toThrow('progress store down')
    expect(memory.state.events).toEqual([])
    expect(memory.state.cursors[0]).toEqual(expect.objectContaining({ scanId: null, lastFullReconciledAt: null, contractHashes: null }))
    enqueueXrayBackfill.mockClear()
    const next = await runXrayIngestJob(container(null), SCOPE)
    expect(next).toEqual(expect.objectContaining({ status: 'caught_up', scanStarted: expect.objectContaining({ kind: 'full_reconcile' }) }))
    expect(next.status === 'caught_up' && next.scanStarted?.processKeys).toBeFalsy()
    expect(memory.state.cursors[0]).toEqual(expect.objectContaining({ scanKind: 'full_reconcile', scanFrom: '2026-09-08T10:00:00.000000Z' }))
    expect(enqueueXrayBackfill).toHaveBeenCalledTimes(1)
  })

  it('leaves every process to be cleared and rebuilt when the clearing of a rebuild fails midway', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    memory.state.events.push(projectedEvent(`tk1:${USER_ID}`))
    jest.spyOn(memory.store, 'clearProjectionBatch').mockRejectedValueOnce(new Error('connection reset'))
    await expect(rebuildXrayProjection(container(progressService()), SCOPE, LABELS)).rejects.toThrow('connection reset')
    expect(memory.state.cursors[0].contractHashes).toEqual({})
    expect(memory.state.events).toHaveLength(1)
    const next = await runXrayIngestJob(container(null), SCOPE)
    expect(next).toEqual(expect.objectContaining({
      contractChange: { changed: [], added: ['test.deal'], removed: [] },
      scanStarted: expect.objectContaining({ kind: 'full_reconcile', processKeys: ['test.deal'] }),
    }))
    expect(memory.state.events).toEqual([])
  })

  it('refuses to rebuild while another worker holds the lease', async () => {
    const cursor = await memory.store.ensureCursor(SCOPE, 60_000)
    await memory.store.acquireLease(cursor, 'other', 120_000)
    expect(await rebuildXrayProjection(container(null), SCOPE, LABELS)).toEqual({ ok: false, reason: 'lease_busy' })
  })

  it('never clears the projection while ingest is disabled', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    memory.state.events.push({ ...projectedEvent(`tk1:${USER_ID}`), organizationId: ORG_ID })
    isXrayIngestEnabled.mockResolvedValueOnce(false)
    expect(await rebuildXrayProjection(container(progressService()), SCOPE, LABELS)).toEqual({ ok: false, reason: 'disabled' })
    expect(memory.state.events).toHaveLength(1)
  })

  it('records the erasure ledger and re-pseudonymizes the erased user as actor and as user value', async () => {
    await runXrayIngestJob(container(null), SCOPE)
    memory.state.events.push(projectedEvent(`tk1:${USER_ID}`), { ...projectedEvent('tk1:someone-else'), followupField: 'ownerUserId', followupValue: `tk1:${USER_ID}` })
    expect(await eraseXrayActor(container(null), TENANT_ID, USER_ID)).toBe(2)
    const replacement = memory.state.erasures.get(`${TENANT_ID}|${USER_ID}`)
    expect(replacement).toEqual(expect.stringMatching(/^erased:/))
    expect(memory.state.events.map((event) => [event.actorPseudonym, event.followupValue])).toEqual([
      [replacement, null],
      ['tk1:someone-else', replacement],
    ])
    expect(await eraseXrayActor(container(null), TENANT_ID, USER_ID)).toBe(0)
    expect(memory.state.erasures.size).toBe(1)
  })

  it('keeps the ledger and fails (for a retry) when the key is unavailable or an organization used another key', async () => {
    createActorPseudonymizer.mockRejectedValueOnce(new Error('[internal] The tenant key for Process X-Ray actor pseudonyms is unavailable'))
    await expect(eraseXrayActor(container(null), TENANT_ID, USER_ID)).rejects.toThrow('tenant key')
    expect(memory.state.erasures.size).toBe(1)

    await runXrayIngestJob(container(null), SCOPE)
    memory.state.cursors[0].actorKeyFingerprint = 'tk1:old-key'
    await expect(eraseXrayActor(container(null), TENANT_ID, USER_ID)).rejects.toBeInstanceOf(XrayErasureIncompleteError)
  })
})
