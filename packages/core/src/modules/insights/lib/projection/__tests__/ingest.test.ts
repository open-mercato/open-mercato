import {
  XRAY_KEY_MISMATCH_ERROR,
  XRAY_OVERLAP_MS,
  XRAY_OVERLAP_STEP_MS,
  XRAY_PAGE_LIMIT,
  XRAY_SETTLE_MS,
  XRAY_WINDOW_INITIAL_MS,
  buildPageWrites,
  compareIso,
  runIngestSlice,
  runScanSlice,
  shiftIso,
  type XrayIngestDeps,
} from '../ingest'
import type { ActorPseudonymizer } from '../pseudonym'
import { createMemoryLogSource, createMemoryStore, microIso, type MemoryLogRow, type MemoryLogSourceOptions } from './memoryProjection'
import {
  DEAL_ID,
  ORG_ID,
  OTHER_ORG_ID,
  OTHER_USER_ID,
  PAYMENT_ID,
  STAGE_A,
  TENANT_ID,
  USER_ID,
  nextLogId,
  testProcessConfig,
  testRegistry,
} from '../../process/__tests__/processTestSupport'
import { buildProcessRegistrySnapshot } from '../../process/registry'
import { valueCapScope } from '../../process/values'

const ROLE_ID = '88888888-0000-4000-8000-000000000001'
const TEAM_ID = '99999999-0000-4000-8000-000000000001'
const START = '2026-10-08T10:00:00.000000Z'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const MINUTE = 60_000
const CHAIN_ID = 'eeeeeeee-0000-4000-8000-000000000001'
const KEY_FINGERPRINT = 'tk1:test-key'

function testPseudonymizer(fingerprint = KEY_FINGERPRINT): ActorPseudonymizer {
  return { mode: 'tenant_key', fingerprint, pseudonymize: (userId) => `tk1:${userId.slice(0, 8)}` }
}

function at(offsetMs: number): string {
  return microIso(new Date(Date.parse(START) + offsetMs))
}

function logRow(overrides: Partial<MemoryLogRow> = {}): MemoryLogRow {
  const createdAt = overrides.createdAt ?? at(0)
  return {
    logId: nextLogId(),
    at: createdAt,
    commandId: 'test.deals.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: USER_ID,
    actorKind: 'user',
    resourceKind: 'test.deal',
    resourceId: DEAL_ID,
    changedFields: null,
    snapshotBefore: { deal: { status: 'open', stageId: STAGE_A, ownerUserId: USER_ID } },
    snapshotAfter: { deal: { status: 'won', stageId: STAGE_A, ownerUserId: USER_ID } },
    changes: null,
    causeKind: 'user',
    causeId: null,
    organizationId: ORG_ID,
    actionLabel: null,
    onBehalfOfUserId: null,
    parentResourceKind: null,
    parentResourceId: null,
    correlationId: null,
    causedByLogId: null,
    causation: null,
    historyAction: null,
    sourceLogId: null,
    tenantId: TENANT_ID,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    ...overrides,
  }
}

function createRow(dealId: string, createdAt: string, status = 'open'): MemoryLogRow {
  return logRow({
    resourceId: dealId,
    createdAt,
    actionType: 'create',
    commandId: 'test.deals.create',
    snapshotBefore: null,
    snapshotAfter: { deal: { status, stageId: STAGE_A, ownerUserId: USER_ID } },
  })
}

function setup(options: { now?: string; rows?: MemoryLogRow[]; clock?: () => number; source?: MemoryLogSourceOptions } = {}) {
  const memory = createMemoryStore(options.now ?? START)
  const rows = options.rows ?? []
  const logSource = createMemoryLogSource(rows, options.source)
  const resolveActorDimensions = jest.fn(async (userIds: string[]) => new Map(userIds.map((id) => [id, { roleIds: [ROLE_ID], teamId: TEAM_ID }])))
  const deps: XrayIngestDeps = {
    store: memory.store,
    logSource,
    registry: testRegistry(),
    pseudonymizer: testPseudonymizer(),
    resolveActorDimensions,
    redactedFields: new Set(),
    owner: 'worker-a',
    clock: options.clock ?? (() => 0),
  }
  return { memory, rows, logSource, deps, resolveActorDimensions, setNow: (value: string) => { memory.state.clock.now = value } }
}

describe('runIngestSlice — incremental cursor', () => {
  it('starts at now minus the settle lag and only re-scans the overlap window before it', async () => {
    const harness = setup({ now: at(10 * MINUTE), rows: [createRow(DEAL_ID, at(-20 * MINUTE)), createRow(PAYMENT_ID, at(0))] })
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('caught_up')
    expect(new Set(harness.memory.state.events.map((event) => event.caseId))).toEqual(new Set([PAYMENT_ID]))
    const cursor = harness.memory.state.cursors[0]
    expect(cursor.lastCreatedAt).toBe(shiftIso(at(10 * MINUTE), -XRAY_SETTLE_MS))
    expect(cursor.leaseOwner).toBeNull()
  })

  it('projects rows up to now minus the settle lag and advances the cursor', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(createRow(DEAL_ID, at(1 * MINUTE)), logRow({ createdAt: at(2 * MINUTE) }), createRow(OTHER_USER_ID, at(4 * MINUTE + 30_000)))
    harness.setNow(at(5 * MINUTE))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result).toEqual(expect.objectContaining({ status: 'caught_up', inserted: 4 }))
    expect(harness.memory.state.events.map((event) => event.activityKey)).toEqual(['created', 'status:open', `stageId:${STAGE_A}`, 'status:won'])
    expect(harness.memory.state.cursors[0].lastCreatedAt).toBe(shiftIso(at(5 * MINUTE), -XRAY_SETTLE_MS))
    const [event] = harness.memory.state.events
    expect(event).toEqual(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      actorPseudonym: `tk1:${USER_ID.slice(0, 8)}`,
      actorRoleIds: [ROLE_ID],
      actorTeamId: TEAM_ID,
      causeKind: 'user',
      voided: false,
    }))
    expect(harness.memory.state.cases).toEqual([expect.objectContaining({ caseId: DEAL_ID, status: 'completed', eventCount: 4 })])

    harness.setNow(at(6 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events.filter((row) => row.caseId === OTHER_USER_ID).map((row) => row.activityKey)).toEqual(['created', 'status:open', `stageId:${STAGE_A}`])
  })

  it('re-scans the 15 minutes before the cursor for late-committed rows without duplicating', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(createRow(DEAL_ID, at(1 * MINUTE)))
    harness.setNow(at(20 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events).toHaveLength(3)
    harness.rows.push(logRow({ createdAt: at(10 * MINUTE) }), logRow({ resourceId: OTHER_USER_ID, createdAt: at(1 * MINUTE - 60_000) }))
    harness.setNow(at(22 * MINUTE))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.inserted).toBe(1)
    expect(harness.memory.state.events.map((event) => event.activityKey)).toEqual(['created', 'status:open', `stageId:${STAGE_A}`, 'status:won'])
    const again = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(again.inserted).toBe(0)
    expect(harness.memory.state.events).toHaveLength(4)
  })

  it('leaves rows within the settle lag for the next run', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(createRow(DEAL_ID, at(4 * MINUTE + 30_000)))
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events).toEqual([])
    harness.setNow(at(6 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events).toHaveLength(3)
  })

  it('stops at the slice time budget and resumes from the persisted position', async () => {
    let elapsed = 0
    const harness = setup({ now: at(0), clock: () => elapsed })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    for (let index = 0; index < XRAY_PAGE_LIMIT + 50; index += 1) {
      harness.rows.push(logRow({ resourceId: DEAL_ID, createdAt: at(MINUTE + index * 10), snapshotBefore: { deal: { status: `s_${index}` } }, snapshotAfter: { deal: { status: `s_${index + 1}` } } }))
    }
    harness.setNow(at(10 * MINUTE))
    const originalCommit = harness.memory.store.commit
    harness.deps.store = {
      ...harness.memory.store,
      commit: async (lease, leaseMs, batch) => {
        const outcome = await originalCommit(lease, leaseMs, batch)
        if (batch.advance.kind === 'main') elapsed = 60_000
        return outcome
      },
    }
    const first = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(first.status).toBe('budget_exhausted')
    expect(harness.memory.state.events).toHaveLength(XRAY_PAGE_LIMIT)
    harness.deps.store = harness.memory.store
    elapsed = 0
    const second = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(second.status).toBe('caught_up')
    expect(harness.memory.state.events).toHaveLength(XRAY_PAGE_LIMIT + 50)
  })

  it('ignores rows of other organizations', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(createRow(DEAL_ID, at(MINUTE)), { ...createRow(PAYMENT_ID, at(MINUTE)), organizationId: OTHER_ORG_ID })
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(new Set(harness.memory.state.events.map((event) => event.caseId))).toEqual(new Set([DEAL_ID]))
  })
})

describe('runIngestSlice — undo and redo', () => {
  it('voids the source event when the undo trace arrives and recomputes the case', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const create = createRow(DEAL_ID, at(MINUTE))
    const update = logRow({ createdAt: at(2 * MINUTE) })
    harness.rows.push(create, update)
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.cases[0].status).toBe('completed')
    const trace = logRow({ createdAt: at(6 * MINUTE), causeKind: 'undo', causeId: update.logId })
    harness.rows.push(trace)
    harness.setNow(at(8 * MINUTE))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.voided).toBe(1)
    const voided = harness.memory.state.events.find((event) => event.sourceLogId === update.logId)
    expect(voided).toEqual(expect.objectContaining({ voided: true, voidedByLogId: trace.logId }))
    expect(harness.memory.state.cases[0]).toEqual(expect.objectContaining({ status: 'open', eventCount: 3 }))
  })

  it('voids through the updated_at state pass when the source row is marked undone', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const update = logRow({ createdAt: at(MINUTE) })
    harness.rows.push(update)
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    update.executionState = 'undone'
    update.updatedAt = at(6 * MINUTE)
    harness.setNow(at(8 * MINUTE))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.voided).toBe(1)
    expect(harness.memory.state.events[0]).toEqual(expect.objectContaining({ voided: true, voidedByLogId: null }))
    expect(harness.memory.state.cases).toEqual([])
    expect(harness.memory.state.cursors[0].stateWatermark).toBe(shiftIso(at(8 * MINUTE), -XRAY_SETTLE_MS))
  })

  it('projects a row already undone at ingest as voided and a redo row as a new event', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const undone = logRow({ createdAt: at(MINUTE), executionState: 'redone' })
    const redo = logRow({ createdAt: at(2 * MINUTE), causeKind: 'redo', causeId: undone.logId })
    harness.rows.push(undone, redo)
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events.map((event) => [event.sourceLogId, event.voided, event.causeKind])).toEqual([
      [undone.logId, true, 'user'],
      [redo.logId, false, 'redo'],
    ])
  })
})

describe('runIngestSlice — re-scans of undone rows', () => {
  it('voids events projected before the row was undone when a range scan re-reads it', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const update = logRow({ createdAt: at(MINUTE) })
    harness.rows.push(update)
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events[0].voided).toBe(false)
    update.executionState = 'undone'
    const cursor = harness.memory.state.cursors[0]
    const scanId = 'dddddddd-0000-4000-8000-000000000001'
    await harness.memory.store.startScan(cursor, { scanId, chainId: CHAIN_ID, kind: 'reconcile', from: at(0), until: at(5 * MINUTE), progressJobId: null })
    const result = await runScanSlice(harness.deps, SCOPE, scanId, CHAIN_ID)
    expect(result).toEqual(expect.objectContaining({ status: 'completed', voided: 1, inserted: 0 }))
    expect(harness.memory.state.events[0]).toEqual(expect.objectContaining({ voided: true, voidedByLogId: null }))
  })
})

describe('runIngestSlice — lease, contract and registry', () => {
  it('skips while another worker holds the lease', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const cursor = harness.memory.state.cursors[0]
    cursor.leaseOwner = 'worker-b'
    cursor.leaseUntil = at(MINUTE)
    harness.rows.push(createRow(DEAL_ID, at(10_000)))
    harness.setNow(at(30_000))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('lease_busy')
    expect(harness.memory.state.events).toEqual([])
    expect(cursor.leaseOwner).toBe('worker-b')
  })

  it('takes over an expired lease with a higher fencing token', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const cursor = harness.memory.state.cursors[0]
    cursor.leaseOwner = 'crashed-worker'
    cursor.leaseUntil = at(-MINUTE)
    const tokenBefore = cursor.leaseToken
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('caught_up')
    expect(cursor.leaseToken).toBe(tokenBefore + 1)
  })

  it('stops writing when the lease is taken over mid-slice (fencing)', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    for (let index = 0; index < XRAY_PAGE_LIMIT + 10; index += 1) {
      harness.rows.push(logRow({ createdAt: at(MINUTE + index), snapshotBefore: { deal: { status: `a_${index}` } }, snapshotAfter: { deal: { status: `b_${index}` } } }))
    }
    harness.setNow(at(10 * MINUTE))
    const originalCommit = harness.memory.store.commit
    let commits = 0
    harness.deps.store = {
      ...harness.memory.store,
      commit: async (lease, leaseMs, batch) => {
        commits += 1
        if (commits === 2) harness.memory.state.cursors[0].leaseToken += 1
        return originalCommit(lease, leaseMs, batch)
      },
    }
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('lease_lost')
    expect(harness.memory.state.events).toHaveLength(XRAY_PAGE_LIMIT)
  })

  it('flags rebuild_required when the contract changed and projects nothing', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(createRow(DEAL_ID, at(10_000)))
    harness.setNow(at(5 * MINUTE))
    const base = testProcessConfig()
    const process = base.processes?.[0]
    if (!process) throw new Error('[internal] missing test process')
    harness.deps.registry = buildProcessRegistrySnapshot(
      [{ moduleId: 'test', config: { version: 1, processes: [{ ...process, endStates: [{ field: 'status', values: ['won'] }] }] } }],
      [],
    )
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('rebuild_required')
    expect(harness.memory.state.cursors[0].status).toBe('rebuild_required')
    expect(harness.memory.state.events).toEqual([])
  })

  it('does nothing without registered processes (module disabled or no declarations)', async () => {
    const harness = setup({ now: at(0), rows: [createRow(DEAL_ID, at(-MINUTE))] })
    harness.deps.registry = buildProcessRegistrySnapshot([], [])
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('no_processes')
    expect(harness.memory.state.cursors).toEqual([])
    expect(harness.logSource.scanCalls).toEqual([])
  })
})

describe('runIngestSlice — maintenance', () => {
  it('starts a 48 h reconciliation when the last one is older than a day and a full one weekly', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    const cursor = harness.memory.state.cursors[0]
    cursor.lastReconciledAt = at(-25 * 60 * MINUTE)
    const nightly = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    expect(nightly.scanStarted).toEqual(expect.objectContaining({ kind: 'reconcile', from: shiftIso(at(0), -48 * 60 * MINUTE), until: shiftIso(at(0), -XRAY_SETTLE_MS) }))
    expect(cursor.status).toBe('backfilling')

    const second = setup({ now: at(0) })
    await runIngestSlice(second.deps, SCOPE, { retentionDays: 30 })
    second.memory.state.cursors[0].lastFullReconciledAt = at(-8 * 24 * 60 * MINUTE)
    const weekly = await runIngestSlice(second.deps, SCOPE, { retentionDays: 30 })
    expect(weekly.scanStarted).toEqual(expect.objectContaining({ kind: 'full_reconcile', from: shiftIso(at(0), -30 * 24 * 60 * MINUTE) }))
  })

  it('hands a stalled range scan to a new job chain and prunes once a day', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    const cursor = harness.memory.state.cursors[0]
    const scanId = 'aaaaaaaa-0000-4000-8000-000000000001'
    await harness.memory.store.startScan(cursor, { scanId, chainId: CHAIN_ID, kind: 'backfill', from: at(-MINUTE), until: at(0), progressJobId: 'ffffffff-0000-4000-8000-000000000001' })
    cursor.scanUpdatedAt = at(-11 * MINUTE)
    cursor.lastPrunedAt = at(-25 * 60 * MINUTE)
    const prune = jest.spyOn(harness.memory.store, 'pruneProjectionBatch')
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    expect(result.scanResumed).toEqual({ scanId, chainId: cursor.scanChainId, progressJobId: 'ffffffff-0000-4000-8000-000000000001' })
    expect(cursor.scanChainId).not.toBe(CHAIN_ID)
    expect(result.scanStarted).toBeNull()
    expect(prune).toHaveBeenCalledTimes(3)
    expect(cursor.lastPrunedAt).toBe(at(0))

    const stale = await runScanSlice(harness.deps, SCOPE, scanId, CHAIN_ID)
    expect(stale.status).toBe('stale_chain')
    const again = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    expect(again.scanResumed).toBeNull()
  })

  it('never lets a due reconciliation replace a running scan', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    const cursor = harness.memory.state.cursors[0]
    await harness.memory.store.startScan(cursor, { scanId: 'aaaaaaaa-0000-4000-8000-000000000002', chainId: CHAIN_ID, kind: 'backfill', from: at(-MINUTE), until: at(0), progressJobId: null })
    cursor.lastReconciledAt = at(-25 * 60 * MINUTE)
    cursor.lastFullReconciledAt = at(-8 * 24 * 60 * MINUTE)
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 30 })
    expect(result.scanStarted).toBeNull()
    expect(cursor).toEqual(expect.objectContaining({ scanId: 'aaaaaaaa-0000-4000-8000-000000000002', scanKind: 'backfill', scanChainId: CHAIN_ID }))
  })
})

describe('runScanSlice — backfill', () => {
  it('projects history in the scan range, resumes after a crash and completes without duplicates', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    for (let index = 0; index < XRAY_PAGE_LIMIT + 20; index += 1) {
      harness.rows.push(logRow({ createdAt: at(-60 * MINUTE + index), snapshotBefore: { deal: { status: `a_${index}` } }, snapshotAfter: { deal: { status: `b_${index}` } } }))
    }
    harness.rows.push(createRow(PAYMENT_ID, at(-2 * 24 * 60 * MINUTE)))
    const cursor = harness.memory.state.cursors[0]
    const scanId = 'bbbbbbbb-0000-4000-8000-000000000001'
    await harness.memory.store.startScan(cursor, { scanId, chainId: CHAIN_ID, kind: 'backfill', from: at(-24 * 60 * MINUTE), until: at(0), progressJobId: null })
    const originalCommit = harness.memory.store.commit
    let committedEvents = false
    harness.deps.store = {
      ...harness.memory.store,
      commit: async (lease, leaseMs, batch) => {
        if (committedEvents) throw new Error('worker killed')
        const outcome = await originalCommit(lease, leaseMs, batch)
        if (batch.events.length > 0) committedEvents = true
        return outcome
      },
    }
    await expect(runScanSlice(harness.deps, SCOPE, scanId, CHAIN_ID)).rejects.toThrow('worker killed')
    expect(harness.memory.state.events).toHaveLength(XRAY_PAGE_LIMIT)
    expect(cursor.scanProcessedCount).toBe(XRAY_PAGE_LIMIT)
    expect(cursor.leaseOwner).toBeNull()

    harness.deps.store = harness.memory.store
    const resumed = await runScanSlice(harness.deps, SCOPE, scanId, CHAIN_ID)
    expect(resumed.status).toBe('completed')
    expect(harness.memory.state.events).toHaveLength(XRAY_PAGE_LIMIT + 20)
    expect(new Set(harness.memory.state.events.map((event) => event.caseId))).toEqual(new Set([DEAL_ID]))
    expect(cursor).toEqual(expect.objectContaining({ scanId: null, status: 'idle', lastFullReconciledAt: at(0) }))
  })

  it('stops a superseded scan', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const cursor = harness.memory.state.cursors[0]
    await harness.memory.store.startScan(cursor, { scanId: 'cccccccc-0000-4000-8000-000000000001', chainId: CHAIN_ID, kind: 'backfill', from: null, until: at(0), progressJobId: null })
    await harness.memory.store.startScan(cursor, { scanId: 'cccccccc-0000-4000-8000-000000000002', chainId: CHAIN_ID, kind: 'backfill', from: null, until: at(0), progressJobId: null })
    const result = await runScanSlice(harness.deps, SCOPE, 'cccccccc-0000-4000-8000-000000000001', CHAIN_ID)
    expect(result.status).toBe('superseded')
  })
})

describe('runIngestSlice — pseudonym key', () => {
  it('pins the key on first use and pauses without writing while another key is in use', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const cursor = harness.memory.state.cursors[0]
    expect(cursor.actorKeyFingerprint).toBe(KEY_FINGERPRINT)
    harness.rows.push(createRow(DEAL_ID, at(MINUTE)))
    harness.setNow(at(5 * MINUTE))
    harness.deps.pseudonymizer = testPseudonymizer('tk1:another-key')
    const paused = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(paused.status).toBe('key_mismatch')
    expect(harness.memory.state.events).toEqual([])
    expect(cursor).toEqual(expect.objectContaining({ lastError: XRAY_KEY_MISMATCH_ERROR, leaseOwner: null, actorKeyFingerprint: KEY_FINGERPRINT }))
    harness.deps.pseudonymizer = testPseudonymizer()
    const resumed = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(resumed.status).toBe('caught_up')
    expect(harness.memory.state.events).toHaveLength(3)
    expect(cursor.lastError).toBeNull()
  })

  it('records no actor and no user value without a pseudonym key, and adopts a key configured later', async () => {
    const harness = setup({ now: at(0) })
    harness.deps.pseudonymizer = { mode: 'none', fingerprint: 'none', pseudonymize: () => null }
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(logRow({
      createdAt: at(MINUTE),
      snapshotBefore: { deal: { status: 'open', stageId: STAGE_A, ownerUserId: USER_ID } },
      snapshotAfter: { deal: { status: 'won', stageId: STAGE_A, ownerUserId: OTHER_USER_ID } },
    }))
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events.map((event) => [event.activityKey, event.actorPseudonym, event.followupValue])).toEqual([
      ['status:won', null, 'won'],
      ['ownerUserId:changed', null, 'other'],
    ])
    const cursor = harness.memory.state.cursors[0]
    expect(cursor.actorKeyFingerprint).toBe('none')
    harness.deps.pseudonymizer = testPseudonymizer()
    const adopted = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(adopted.status).toBe('caught_up')
    expect(cursor.actorKeyFingerprint).toBe(KEY_FINGERPRINT)
  })
})

describe('runIngestSlice — erasure ledger', () => {
  it('replaces an erased user as actor and as user value in every later projection', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const replacement = await harness.memory.store.recordErasure(TENANT_ID, USER_ID)
    harness.rows.push(logRow({
      createdAt: at(MINUTE),
      snapshotBefore: { deal: { status: 'open', stageId: STAGE_A, ownerUserId: OTHER_USER_ID } },
      snapshotAfter: { deal: { status: 'won', stageId: STAGE_A, ownerUserId: USER_ID } },
    }))
    harness.setNow(at(5 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(harness.memory.state.events.map((event) => [event.activityKey, event.actorPseudonym, event.followupValue])).toEqual([
      ['status:won', replacement, 'won'],
      ['ownerUserId:changed', replacement, replacement],
    ])
    expect(JSON.stringify(harness.memory.state.events)).not.toContain(`tk1:${USER_ID.slice(0, 8)}`)
  })
})

describe('runIngestSlice — windowed reads', () => {
  it('halves the read window on a statement timeout and still covers the whole range', async () => {
    let timeouts = 0
    const harness = setup({
      now: at(0),
      source: {
        timeoutWhen: (query) => {
          if (!query.after || Date.parse(query.until) - Date.parse(query.after.createdAt) <= 10 * MINUTE) return false
          timeouts += 1
          return true
        },
      },
    })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(createRow(DEAL_ID, at(MINUTE)), logRow({ createdAt: at(50 * MINUTE) }))
    harness.setNow(at(60 * MINUTE))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('caught_up')
    expect(timeouts).toBeGreaterThan(0)
    expect(harness.memory.state.events.map((event) => event.activityKey)).toEqual(['created', 'status:open', `stageId:${STAGE_A}`, 'status:won'])
    expect(harness.memory.state.cursors[0].lastCreatedAt).toBe(shiftIso(at(60 * MINUTE), -XRAY_SETTLE_MS))
  })

  it('grows the window over a sparse range so a long gap is covered in few reads', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const cursor = harness.memory.state.cursors[0]
    cursor.lastCreatedAt = at(-30 * 24 * 60 * MINUTE)
    harness.rows.push(createRow(DEAL_ID, at(-10 * 24 * 60 * MINUTE)))
    harness.logSource.scanCalls.length = 0
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result.status).toBe('caught_up')
    expect(harness.memory.state.events.map((event) => event.caseId)).toEqual([DEAL_ID, DEAL_ID, DEAL_ID])
    const mainReads = harness.logSource.scanCalls.slice(XRAY_OVERLAP_MS / XRAY_OVERLAP_STEP_MS)
    expect(mainReads.length).toBeLessThanOrEqual(12)
    expect(compareIso(mainReads[0].after?.createdAt ?? '', at(-30 * 24 * 60 * MINUTE))).toBe(0)
    expect(Date.parse(mainReads[0].until) - Date.parse(mainReads[0].after?.createdAt ?? '')).toBe(XRAY_WINDOW_INITIAL_MS)
  })

  it('fails the slice and releases the lease when even the smallest window times out', async () => {
    const harness = setup({ now: at(0), source: { timeoutWhen: () => true } })
    await expect(runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })).rejects.toMatchObject({ code: '57014' })
    expect(harness.memory.state.cursors[0].leaseOwner).toBeNull()
  })

  it('counts rows it cannot decrypt and moves past them', async () => {
    const update = logRow({ createdAt: at(MINUTE) })
    const harness = setup({ now: at(0), source: { undecryptableIds: new Set([update.logId]) } })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.rows.push(update)
    harness.setNow(at(5 * MINUTE))
    const result = await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    expect(result).toEqual(expect.objectContaining({ status: 'caught_up', undecryptable: 1, inserted: 0 }))
    expect(harness.memory.state.cursors[0].lastCreatedAt).toBe(shiftIso(at(5 * MINUTE), -XRAY_SETTLE_MS))
  })

  it('re-reads the newest minutes before the cursor first', async () => {
    const harness = setup({ now: at(0) })
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    harness.setNow(at(20 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const cursorAt = harness.memory.state.cursors[0].lastCreatedAt ?? ''
    harness.logSource.scanCalls.length = 0
    harness.setNow(at(21 * MINUTE))
    await runIngestSlice(harness.deps, SCOPE, { retentionDays: 365 })
    const steps = XRAY_OVERLAP_MS / XRAY_OVERLAP_STEP_MS
    expect(harness.logSource.scanCalls.slice(0, steps).map((query) => [query.after?.createdAt, query.until])).toEqual(
      Array.from({ length: steps }, (_unused, index) => [shiftIso(cursorAt, -(index + 1) * XRAY_OVERLAP_STEP_MS), shiftIso(cursorAt, -index * XRAY_OVERLAP_STEP_MS)]),
    )
  })
})

describe('buildPageWrites', () => {
  it('pseudonymizes user follow-up values, redacts tenant-encrypted fields and applies the cardinality cap', async () => {
    const harness = setup({ now: at(0) })
    harness.deps.redactedFields = new Set([valueCapScope('test.deal', 'priority')])
    const writes = await buildPageWrites(harness.deps, SCOPE, [
      { ...logRow({
        snapshotBefore: { deal: { status: 'open', ownerUserId: USER_ID, priority: 'low' } },
        snapshotAfter: { deal: { status: 'won', ownerUserId: OTHER_USER_ID, priority: 'secret_high' } },
      }), cursorAt: at(0) },
    ], new Map([[valueCapScope('test.deal', 'status'), new Set(Array.from({ length: 200 }, (_unused, index) => `v_${index}`))]]))
    expect(writes.events.map((event) => [event.activityKey, event.followupField, event.followupValue])).toEqual([
      ['status:other', 'status', 'other'],
      ['ownerUserId:changed', 'ownerUserId', `tk1:${OTHER_USER_ID.slice(0, 8)}`],
      ['priority:changed', 'priority', 'other'],
    ])
    expect(writes.voids).toEqual([])
    expect(harness.resolveActorDimensions).toHaveBeenCalledWith([USER_ID])
  })

  it('loads the stored distinct values once per field before capping', async () => {
    const harness = setup({ now: at(0) })
    const load = jest.spyOn(harness.memory.store, 'loadDistinctValues')
    const capState = new Map<string, Set<string>>()
    await buildPageWrites(harness.deps, SCOPE, [{ ...logRow(), cursorAt: at(0) }, { ...logRow(), cursorAt: at(1) }], capState)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(SCOPE, 'test.deal', 'status', 201)
    expect(capState.get(valueCapScope('test.deal', 'status'))).toEqual(new Set(['won']))
  })

  it('groups undo voids by the undoing row', async () => {
    const harness = setup({ now: at(0) })
    const source = nextLogId()
    const trace = logRow({ causeKind: 'undo', causeId: source })
    const writes = await buildPageWrites(harness.deps, SCOPE, [{ ...trace, cursorAt: at(0) }], new Map())
    expect(writes).toEqual({ events: [], voids: [{ voidedByLogId: trace.logId, sourceLogIds: [source] }] })
  })

  it('keeps the overlap window at 15 minutes', () => {
    expect(XRAY_OVERLAP_MS).toBe(15 * MINUTE)
  })
})
