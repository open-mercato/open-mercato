/**
 * Step 2.3 (A11/A12/A13). `expireAvailabilityReservations`/`reconcileAvailabilityReservations`
 * against a mocked `EntityManager` and a fake `wmsReservationService` — the same
 * mocked-dependency style `customer_groups:credit-exposure-audit`'s own test uses
 * (`../../customer_groups/workers/__tests__/credit-exposure-audit.test.ts`).
 *
 * Covers:
 *  - the expiry job's false-positive guard: only `active` holds PAST `expires_at` are
 *    CAS-transitioned and released; `active`-but-not-due, `committed`, `released` and
 *    already-`expired` holds are left untouched;
 *  - each of the three reconciliation drift cases (a/b/c), with a concrete fixture, repaired
 *    AND reported (never silently);
 *  - every event payload this Step emits carries `tenantId`/`organizationId` (X11);
 *  - the A13 distinction: these jobs only ever emit `availability.reservation.*` ids, never
 *    `availability.shortfall.detected` (reserve/commit's own signal) nor anything resembling
 *    `wms.inventory.reservation_shortfall` (a different module's order-automation signal).
 */
const emittedEvents: Array<{ id: string; payload: Record<string, unknown> }> = []
const reportedErrors: Array<{ message: string; meta: Record<string, unknown> }> = []

jest.mock('../../events', () => ({
  emitAvailabilityEvent: async (id: string, payload: Record<string, unknown>) => {
    emittedEvents.push({ id, payload })
  },
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({
    reportError: (error: Error, meta: Record<string, unknown>) => {
      reportedErrors.push({ message: error.message, meta })
    },
  }),
}))

import { expireAvailabilityReservations, reconcileAvailabilityReservations } from '../reservationSweep'

const TENANT = 'tenant-1'
const ORG = 'org-1'

type Row = Record<string, unknown>

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    const ops = condition as Record<string, unknown>
    if ('$lt' in ops) return value instanceof Date && (ops.$lt as Date).getTime() > value.getTime()
    if ('$gt' in ops) return typeof value === 'string' && typeof ops.$gt === 'string' && value > (ops.$gt as string)
    if ('$in' in ops) return (ops.$in as unknown[]).includes(value)
  }
  return value === condition
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => matchesCondition(row[key], condition))
}

function createFakeAvailabilityEm(rows: Row[]) {
  const em = {
    fork: () => em,
    find: async (_entity: unknown, where: Row, options?: { limit?: number; orderBy?: unknown }) => {
      const matched = rows.filter((row) => matchesWhere(row, where)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      return options?.limit ? matched.slice(0, options.limit) : matched
    },
    nativeUpdate: async (_entity: unknown, where: Row, set: Row) => {
      const matched = rows.filter((row) => matchesWhere(row, where))
      for (const row of matched) Object.assign(row, set)
      return matched.length
    },
    transactional: async (cb: (trx: unknown) => Promise<void>) => cb(em),
  }
  return em as unknown as import('@mikro-orm/postgresql').EntityManager
}

type WmsRow = { id: string; tenantId: string; organizationId: string; sourceType: string; status: string; createdAt: Date }

function createFakeWmsService(wmsRows: WmsRow[]) {
  const releaseCalls: Array<{ reservationId: string }> = []
  const convertCalls: Array<{ reservationId: string; sourceType: string; sourceId: string }> = []
  const service = {
    releaseCalls,
    convertCalls,
    async reserveLinesForCheckout() {
      throw new Error('not used by this test')
    },
    async releaseInTransaction(_trx: unknown, _ctx: unknown, input: { reservationId: string }) {
      releaseCalls.push({ reservationId: input.reservationId })
      const row = wmsRows.find((r) => r.id === input.reservationId)
      if (row) row.status = 'released'
      return { reservationEntity: { id: input.reservationId }, touchedBalances: [] }
    },
    async convertInTransaction(
      _trx: unknown,
      _ctx: unknown,
      input: { reservationId: string; sourceType: string; sourceId: string },
    ) {
      convertCalls.push({ reservationId: input.reservationId, sourceType: input.sourceType, sourceId: input.sourceId })
      const row = wmsRows.find((r) => r.id === input.reservationId)
      if (row) {
        row.sourceType = input.sourceType
        row.sourceId = input.sourceId
      }
      return { reservationId: input.reservationId, reservationEntity: { id: input.reservationId } }
    },
    async emitSideEffects() {},
    async findReservationsByIds(_trx: unknown, _ctx: unknown, input: { tenantId: string; organizationId: string; ids: string[] }) {
      return wmsRows.filter(
        (row) => row.tenantId === input.tenantId && row.organizationId === input.organizationId && input.ids.includes(row.id),
      )
    },
    async listActiveReservationsBySourceType(
      _trx: unknown,
      input: { tenantId: string; sourceType: string; createdBefore: Date; cursor?: string | null; limit: number },
    ) {
      return wmsRows
        .filter(
          (row) =>
            row.tenantId === input.tenantId &&
            row.sourceType === input.sourceType &&
            row.status === 'active' &&
            row.createdAt.getTime() < input.createdBefore.getTime() &&
            (!input.cursor || row.id > input.cursor),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, input.limit)
    },
  }
  return service
}

function buildContainer(em: unknown, wmsService: unknown | null) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'wmsReservationService') {
        if (!wmsService) throw new Error('not registered')
        return wmsService as T
      }
      throw new Error(`unexpected resolve(${name})`)
    },
  }
}

function buildHold(overrides: Partial<Row> = {}): Row {
  return {
    id: 'hold-1',
    tenantId: TENANT,
    organizationId: ORG,
    idempotencyKey: 'key-1',
    sourceType: 'checkout',
    sourceId: 'session-1',
    status: 'active',
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    items: [{ catalogProductId: 'prod-1', catalogVariantId: 'var-1', requested: 2, outcome: 'held', heldQuantity: 2, backorderQuantity: 0 }],
    wmsReservationIds: [],
    orderId: null,
    statusReason: null,
    createdAt: new Date('2025-12-31T23:00:00Z'),
    updatedAt: new Date('2025-12-31T23:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  emittedEvents.length = 0
  reportedErrors.length = 0
})

describe('expireAvailabilityReservations (A11)', () => {
  const now = new Date('2026-01-01T00:10:00Z')

  it('CAS-transitions only past-due active holds, releasing their wms rows, and leaves every other status untouched', async () => {
    const dueActive = buildHold({ id: 'hold-due', wmsReservationIds: ['wms-due'] })
    const notYetDue = buildHold({ id: 'hold-not-due', expiresAt: new Date('2026-01-01T01:00:00Z'), wmsReservationIds: ['wms-not-due'] })
    const committed = buildHold({ id: 'hold-committed', status: 'committed', wmsReservationIds: ['wms-committed'] })
    const released = buildHold({ id: 'hold-released', status: 'released', wmsReservationIds: ['wms-released'] })
    const alreadyExpired = buildHold({ id: 'hold-expired', status: 'expired', wmsReservationIds: ['wms-expired'] })
    const rows = [dueActive, notYetDue, committed, released, alreadyExpired]

    const wmsRows: WmsRow[] = rows.map((row) => ({
      id: (row.wmsReservationIds as string[])[0],
      tenantId: TENANT,
      organizationId: ORG,
      sourceType: 'checkout',
      status: 'active',
      createdAt: new Date('2025-12-31T23:00:00Z'),
    }))

    const em = createFakeAvailabilityEm(rows)
    const wmsService = createFakeWmsService(wmsRows)
    const container = buildContainer(em, wmsService)

    const result = await expireAvailabilityReservations(container, { tenantId: TENANT }, now)

    expect(result.expiredCount).toBe(1)
    expect(dueActive.status).toBe('expired')
    expect(dueActive.statusReason).toBe('ttl')
    expect(notYetDue.status).toBe('active')
    expect(committed.status).toBe('committed')
    expect(released.status).toBe('released')
    expect(alreadyExpired.status).toBe('expired') // unchanged, same value it started with

    // Only the due hold's wms row was released — the false-positive guard.
    expect(wmsService.releaseCalls).toEqual([{ reservationId: 'wms-due' }])
    expect(wmsRows.find((r) => r.id === 'wms-not-due')!.status).toBe('active')
    expect(wmsRows.find((r) => r.id === 'wms-committed')!.status).toBe('active')

    // A13/X11: exactly one `.expired` event, carrying tenantId/organizationId.
    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].id).toBe('availability.reservation.expired')
    expect(emittedEvents[0].payload).toMatchObject({
      tenantId: TENANT,
      organizationId: ORG,
      reservationId: 'hold-due',
      reason: 'ttl',
    })
  })

  it('skips a hold that lost its CAS race to a concurrent release/commit between read and update', async () => {
    const racedHold = buildHold({ id: 'hold-raced', wmsReservationIds: ['wms-raced'] })
    const wmsRows: WmsRow[] = [
      { id: 'wms-raced', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: new Date('2025-12-31T23:00:00Z') },
    ]
    const em = createFakeAvailabilityEm([racedHold])
    // Simulate another transaction winning the race right after this job's own `find` already
    // returned the row as `active` — the CAS `nativeUpdate`'s own `WHERE status = 'active'`
    // must then match nothing, same as a real concurrent `release`/`commit` winning first.
    const originalFind = em.find.bind(em)
    ;(em as unknown as { find: typeof em.find }).find = (async (...args: Parameters<typeof em.find>) => {
      const found = await originalFind(...args)
      racedHold.status = 'released'
      return found
    }) as typeof em.find
    const wmsService = createFakeWmsService(wmsRows)
    const container = buildContainer(em, wmsService)

    const result = await expireAvailabilityReservations(container, { tenantId: TENANT }, now)

    expect(result.expiredCount).toBe(0)
    expect(racedHold.status).toBe('released') // the racer's status stands, untouched by expiry
    expect(wmsService.releaseCalls).toHaveLength(0)
    expect(emittedEvents).toHaveLength(0)
  })
})

describe('reconcileAvailabilityReservations (A12)', () => {
  const now = new Date('2026-01-02T00:00:00Z')

  it('drift (a): active hold whose wms row is released or missing — releases the rest and CASes the hold to released', async () => {
    const hold = buildHold({ id: 'hold-a', status: 'active', wmsReservationIds: ['wms-a-released', 'wms-a-missing'] })
    const healthyHold = buildHold({ id: 'hold-a-healthy', status: 'active', wmsReservationIds: ['wms-a-healthy'] })
    const wmsRows: WmsRow[] = [
      { id: 'wms-a-released', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'released', createdAt: now },
      // 'wms-a-missing' intentionally absent — simulates a vanished row.
      { id: 'wms-a-healthy', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: now },
    ]
    const em = createFakeAvailabilityEm([hold, healthyHold])
    const wmsService = createFakeWmsService(wmsRows)
    const container = buildContainer(em, wmsService)

    const result = await reconcileAvailabilityReservations(container, { tenantId: TENANT }, now)

    expect(result.releasedHolds).toBe(1)
    expect(hold.status).toBe('released')
    expect(hold.statusReason).toBe('reconciled')
    // The healthy hold (all wms rows still active) is untouched.
    expect(healthyHold.status).toBe('active')
    expect(wmsRows.find((r) => r.id === 'wms-a-healthy')!.status).toBe('active')

    expect(emittedEvents).toEqual([
      expect.objectContaining({
        id: 'availability.reservation.released',
        payload: expect.objectContaining({ tenantId: TENANT, organizationId: ORG, reservationId: 'hold-a', reason: 'reconciled' }),
      }),
    ])
    expect(reportedErrors.some((e) => e.meta.code === 'availability.reconciliation.hold_active_wms_released_or_missing')).toBe(true)
  })

  it('drift (b): an active checkout wms row no hold references is released as an orphan', async () => {
    const referencedHold = buildHold({ id: 'hold-b-referenced', status: 'active', wmsReservationIds: ['wms-b-referenced'] })
    const wmsRows: WmsRow[] = [
      { id: 'wms-b-referenced', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'wms-b-orphan', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: new Date('2026-01-01T00:00:00Z') },
      // Too recent (inside the max-TTL window) — must NOT be treated as drift yet.
      { id: 'wms-b-too-recent', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: now },
    ]
    const em = createFakeAvailabilityEm([referencedHold])
    const wmsService = createFakeWmsService(wmsRows)
    const container = buildContainer(em, wmsService)

    const result = await reconcileAvailabilityReservations(container, { tenantId: TENANT }, now)

    expect(result.orphanWmsReleased).toBe(1)
    expect(wmsService.releaseCalls).toEqual([{ reservationId: 'wms-b-orphan' }])
    expect(wmsRows.find((r) => r.id === 'wms-b-orphan')!.status).toBe('released')
    expect(wmsRows.find((r) => r.id === 'wms-b-referenced')!.status).toBe('active')
    expect(wmsRows.find((r) => r.id === 'wms-b-too-recent')!.status).toBe('active')
    expect(reportedErrors.some((e) => e.meta.code === 'availability.reconciliation.orphan_checkout_wms_reservation')).toBe(true)
  })

  it('drift (c): committed hold whose wms rows are still checkout gets them converted to order', async () => {
    const hold = buildHold({ id: 'hold-c', status: 'committed', orderId: 'order-1', wmsReservationIds: ['wms-c-stale', 'wms-c-already-order'] })
    const wmsRows: WmsRow[] = [
      { id: 'wms-c-stale', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: now },
      { id: 'wms-c-already-order', tenantId: TENANT, organizationId: ORG, sourceType: 'order', status: 'active', createdAt: now },
    ]
    const em = createFakeAvailabilityEm([hold])
    const wmsService = createFakeWmsService(wmsRows)
    const container = buildContainer(em, wmsService)

    const result = await reconcileAvailabilityReservations(container, { tenantId: TENANT }, now)

    expect(result.convertedHolds).toBe(1)
    expect(wmsService.convertCalls).toEqual([{ reservationId: 'wms-c-stale', sourceType: 'order', sourceId: 'order-1' }])
    expect(wmsRows.find((r) => r.id === 'wms-c-stale')!.sourceType).toBe('order')
    expect(reportedErrors.some((e) => e.meta.code === 'availability.reconciliation.hold_committed_wms_still_checkout')).toBe(true)
  })

  it('is a no-op (no repair, no report, no event) when nothing has drifted', async () => {
    const hold = buildHold({ id: 'hold-clean', status: 'active', wmsReservationIds: ['wms-clean'] })
    const wmsRows: WmsRow[] = [
      { id: 'wms-clean', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: now },
    ]
    const em = createFakeAvailabilityEm([hold])
    const wmsService = createFakeWmsService(wmsRows)
    const container = buildContainer(em, wmsService)

    const result = await reconcileAvailabilityReservations(container, { tenantId: TENANT }, now)

    expect(result).toEqual({ releasedHolds: 0, orphanWmsReleased: 0, convertedHolds: 0 })
    expect(emittedEvents).toHaveLength(0)
    expect(reportedErrors).toHaveLength(0)
  })
})

describe('A13 event-id discipline (expiry + reconciliation never emit the wrong signal)', () => {
  it('only ever emits availability.reservation.* ids — never availability.shortfall.detected, which belongs to reserve/commit, and never anything resembling wms.inventory.reservation_shortfall, a different module\'s order-automation signal', async () => {
    const dueActive = buildHold({ id: 'hold-due', wmsReservationIds: ['wms-due'] })
    const driftedActive = buildHold({ id: 'hold-drift-a', status: 'active', wmsReservationIds: ['wms-missing'] })
    const em1 = createFakeAvailabilityEm([dueActive])
    const wmsService1 = createFakeWmsService([{ id: 'wms-due', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', status: 'active', createdAt: new Date('2025-12-31T23:00:00Z') }])
    await expireAvailabilityReservations(buildContainer(em1, wmsService1), { tenantId: TENANT }, new Date('2026-01-01T00:10:00Z'))

    const em2 = createFakeAvailabilityEm([driftedActive])
    const wmsService2 = createFakeWmsService([])
    await reconcileAvailabilityReservations(buildContainer(em2, wmsService2), { tenantId: TENANT }, new Date('2026-01-02T00:00:00Z'))

    expect(emittedEvents.length).toBeGreaterThan(0)
    for (const event of emittedEvents) {
      expect(['availability.reservation.expired', 'availability.reservation.released']).toContain(event.id)
      expect(event.id).not.toBe('availability.shortfall.detected')
      expect(event.payload.tenantId).toBe(TENANT)
      expect(event.payload.organizationId).toBe(ORG)
    }
  })
})
