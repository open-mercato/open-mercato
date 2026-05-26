import { runPendingActionCleanup } from '../ai-pending-action-cleanup'
import type { AiPendingAction } from '../../data/entities'
import {
  AiPendingActionStateError,
  type AiPendingActionStatus,
} from '../../lib/pending-action-types'

type Row = AiPendingAction & Record<string, unknown>

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: overrides.id ?? 'pa_1',
    tenantId: overrides.tenantId ?? 'tenant-alpha',
    organizationId: (overrides as { organizationId?: string | null }).organizationId ?? 'org-alpha',
    agentId: overrides.agentId ?? 'catalog.merchandising_assistant',
    toolName: overrides.toolName ?? 'catalog.update_product',
    status: (overrides.status ?? 'pending') as AiPendingActionStatus,
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: 'v-1',
    attachmentIds: [],
    normalizedInput: {},
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: overrides.idempotencyKey ?? 'idem-1',
    createdByUserId: 'user-1',
    createdAt: overrides.createdAt ?? new Date('2026-04-18T09:00:00.000Z'),
    expiresAt:
      (overrides as { expiresAt?: Date }).expiresAt ?? new Date('2026-04-18T09:15:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  } as Row
}

interface RepoStubOptions {
  seeds: Row[]
  /** ids that should throw AiPendingActionStateError when setStatus is invoked. */
  raceIds?: string[]
  /** ids that should throw a generic error from setStatus. */
  errorIds?: string[]
}

function makeRepoStub(options: RepoStubOptions) {
  const store = new Map<string, Row>()
  for (const row of options.seeds) {
    store.set(row.id, { ...row })
  }
  const raceIds = new Set(options.raceIds ?? [])
  const errorIds = new Set(options.errorIds ?? [])

  const listExpired = jest.fn(
    async (
      ctx: { tenantId: string; organizationId?: string | null },
      now: Date,
      limit: number,
    ) => {
      const all = Array.from(store.values()).filter((row) => {
        if (row.tenantId !== ctx.tenantId) return false
        const expected = ctx.organizationId ?? null
        if ((row.organizationId ?? null) !== expected) return false
        if (row.status !== 'pending') return false
        return row.expiresAt.getTime() < now.getTime()
      })
      all.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
      return all.slice(0, limit)
    },
  )

  const setStatus = jest.fn(
    async (
      id: string,
      next: AiPendingActionStatus,
      _ctx: { tenantId: string; organizationId?: string | null },
      extra?: { now?: Date; resolvedByUserId?: string | null },
    ) => {
      const existing = store.get(id)
      if (!existing) throw new Error(`row ${id} not found`)
      if (raceIds.has(id)) {
        throw new AiPendingActionStateError(existing.status, next)
      }
      if (errorIds.has(id)) {
        throw new Error(`boom-${id}`)
      }
      if (existing.status === next) return existing
      existing.status = next
      existing.resolvedAt = extra?.now ?? new Date()
      if (extra && 'resolvedByUserId' in extra) {
        existing.resolvedByUserId = extra.resolvedByUserId ?? null
      }
      return existing
    },
  )

  return {
    repo: { listExpired, setStatus } as unknown as import('../../data/repositories/AiPendingActionRepository').AiPendingActionRepository,
    listExpired,
    setStatus,
    store,
  }
}

describe('runPendingActionCleanup', () => {
  const clock = new Date('2026-04-18T10:00:00.000Z')
  const em = {} as import('@mikro-orm/postgresql').EntityManager

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('happy path: flips 3 expired rows and emits one ai.action.expired per row', async () => {
    const seeds = [
      makeRow({ id: 'pa-1', idempotencyKey: 'k1' }),
      makeRow({ id: 'pa-2', idempotencyKey: 'k2' }),
      makeRow({ id: 'pa-3', idempotencyKey: 'k3' }),
    ]
    const { repo, setStatus } = makeRepoStub({ seeds })
    const emitEvent = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em,
      repo,
      emitEvent,
      now: clock,
      discoverTenants: async () => [
        { tenantId: 'tenant-alpha', organizationId: 'org-alpha' },
      ],
    })

    expect(setStatus).toHaveBeenCalledTimes(3)
    for (const call of setStatus.mock.calls) {
      expect(call[1]).toBe('expired')
      expect(call[3]).toMatchObject({ resolvedByUserId: null })
    }
    expect(emitEvent).toHaveBeenCalledTimes(3)
    for (const [eventId, payload] of emitEvent.mock.calls) {
      expect(eventId).toBe('ai.action.expired')
      expect(payload.resolvedByUserId).toBeNull()
      expect(payload.status).toBe('expired')
      expect(payload.tenantId).toBe('tenant-alpha')
      expect(payload.organizationId).toBe('org-alpha')
    }
    expect(summary).toEqual({
      tenantsScanned: 1,
      rowsProcessed: 3,
      rowsExpired: 3,
      rowsSkipped: 0,
      rowsErrored: 0,
    })
  })

  it('race-safe: rows flipped under us are caught, logged, and skipped (no emit)', async () => {
    const seeds = [
      makeRow({ id: 'pa-1' }),
      makeRow({ id: 'pa-raced' }),
      makeRow({ id: 'pa-3' }),
    ]
    const { repo, setStatus } = makeRepoStub({
      seeds,
      raceIds: ['pa-raced'],
    })
    const emitEvent = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em,
      repo,
      emitEvent,
      now: clock,
      discoverTenants: async () => [
        { tenantId: 'tenant-alpha', organizationId: 'org-alpha' },
      ],
    })

    expect(setStatus).toHaveBeenCalledTimes(3)
    // Only successful rows produce events
    const emittedIds = emitEvent.mock.calls.map(([, payload]) => payload.pendingActionId)
    expect(emittedIds.sort()).toEqual(['pa-1', 'pa-3'])
    expect(summary.rowsExpired).toBe(2)
    expect(summary.rowsSkipped).toBe(1)
    expect(summary.rowsErrored).toBe(0)
  })

  it('paginates: more than pageSize expired rows take multiple fetch cycles', async () => {
    const seeds: Row[] = []
    for (let i = 0; i < 5; i += 1) {
      seeds.push(
        makeRow({
          id: `pa-${i}`,
          idempotencyKey: `k-${i}`,
          expiresAt: new Date(clock.getTime() - (10 - i) * 1000),
        }),
      )
    }
    const { repo, listExpired, setStatus } = makeRepoStub({ seeds })
    const emitEvent = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em,
      repo,
      emitEvent,
      now: clock,
      pageSize: 2,
      discoverTenants: async () => [
        { tenantId: 'tenant-alpha', organizationId: 'org-alpha' },
      ],
    })

    // 5 rows, pageSize 2 → pages of 2,2,1 → 3 listExpired calls
    expect(listExpired).toHaveBeenCalledTimes(3)
    expect(setStatus).toHaveBeenCalledTimes(5)
    expect(emitEvent).toHaveBeenCalledTimes(5)
    expect(summary.rowsProcessed).toBe(5)
    expect(summary.rowsExpired).toBe(5)
  })

  it('cross-tenant: rows from tenant A and tenant B both get processed', async () => {
    const seeds = [
      makeRow({ id: 'pa-a1', tenantId: 'tenant-alpha', organizationId: 'org-a' }),
      makeRow({ id: 'pa-b1', tenantId: 'tenant-beta', organizationId: 'org-b' }),
      makeRow({ id: 'pa-b2', tenantId: 'tenant-beta', organizationId: 'org-b' }),
    ]
    const { repo, setStatus } = makeRepoStub({ seeds })
    const emitEvent = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em,
      repo,
      emitEvent,
      now: clock,
      discoverTenants: async () => [
        { tenantId: 'tenant-alpha', organizationId: 'org-a' },
        { tenantId: 'tenant-beta', organizationId: 'org-b' },
      ],
    })

    expect(setStatus).toHaveBeenCalledTimes(3)
    const tenantIds = emitEvent.mock.calls.map(([, payload]) => payload.tenantId)
    expect(tenantIds.sort()).toEqual(['tenant-alpha', 'tenant-beta', 'tenant-beta'])
    expect(summary.tenantsScanned).toBe(2)
    expect(summary.rowsExpired).toBe(3)
  })

  it('zero-expired: empty tenant list emits no events and completes cleanly', async () => {
    const { repo, setStatus, listExpired } = makeRepoStub({ seeds: [] })
    const emitEvent = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em,
      repo,
      emitEvent,
      now: clock,
      discoverTenants: async () => [],
    })

    expect(listExpired).not.toHaveBeenCalled()
    expect(setStatus).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(summary).toEqual({
      tenantsScanned: 0,
      rowsProcessed: 0,
      rowsExpired: 0,
      rowsSkipped: 0,
      rowsErrored: 0,
    })
  })

  it('single-row error does not abort the batch', async () => {
    const seeds = [
      makeRow({ id: 'pa-good-1' }),
      makeRow({ id: 'pa-boom' }),
      makeRow({ id: 'pa-good-2' }),
    ]
    const { repo, setStatus } = makeRepoStub({
      seeds,
      errorIds: ['pa-boom'],
    })
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const summary = await runPendingActionCleanup({
        em,
        repo,
        emitEvent,
        now: clock,
        discoverTenants: async () => [
          { tenantId: 'tenant-alpha', organizationId: 'org-alpha' },
        ],
      })

      expect(setStatus).toHaveBeenCalledTimes(3)
      // Only the two good rows emit
      const emittedIds = emitEvent.mock.calls.map(([, payload]) => payload.pendingActionId)
      expect(emittedIds.sort()).toEqual(['pa-good-1', 'pa-good-2'])
      expect(summary.rowsExpired).toBe(2)
      expect(summary.rowsErrored).toBe(1)
      expect(summary.rowsSkipped).toBe(0)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('already-expired row is a no-op on subsequent sweep (idempotency)', async () => {
    // Two rows, both already expired by status — listExpired filters them out,
    // so setStatus is never called and no events are emitted.
    const seeds = [
      makeRow({ id: 'pa-1', status: 'expired' }),
      makeRow({ id: 'pa-2', status: 'expired' }),
    ]
    const { repo, listExpired, setStatus } = makeRepoStub({ seeds })
    const emitEvent = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em,
      repo,
      emitEvent,
      now: clock,
      discoverTenants: async () => [
        { tenantId: 'tenant-alpha', organizationId: 'org-alpha' },
      ],
    })

    expect(listExpired).toHaveBeenCalledTimes(1)
    expect(setStatus).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
    expect(summary.rowsExpired).toBe(0)
  })
})
