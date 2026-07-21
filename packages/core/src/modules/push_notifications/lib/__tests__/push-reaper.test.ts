import { PushNotificationDelivery } from '../../data/entities'
import { enqueuePushDelivery } from '../queue'
import { emitPushNotificationsEvent } from '../../events'
import { reclaimStuckPushDeliveries } from '../push-reaper'

jest.mock('../queue', () => ({
  enqueuePushDelivery: jest.fn(async () => 'job-id'),
  PUSH_DELIVERIES_QUEUE: 'push-deliveries',
  PUSH_STUCK_RECLAIM_QUEUE: 'push-stuck-reclaim',
}))

jest.mock('../../events', () => ({
  emitPushNotificationsEvent: jest.fn(async () => undefined),
}))

const enqueueMock = enqueuePushDelivery as jest.MockedFunction<typeof enqueuePushDelivery>
const emitMock = emitPushNotificationsEvent as jest.MockedFunction<typeof emitPushNotificationsEvent>

const TENANT = '00000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-07-01T12:00:00.000Z')
// Default threshold is 5 min; anything older than this is stale, anything newer is fresh.
const STALE = new Date(NOW.getTime() - 10 * 60 * 1000)
const FRESH = new Date(NOW.getTime() - 1 * 60 * 1000)

function makeRow(overrides: Partial<PushNotificationDelivery> = {}): PushNotificationDelivery {
  return {
    id: `del-${Math.random()}`,
    tenantId: TENANT,
    organizationId: null,
    userId: 'user-1',
    provider: 'push_stub',
    status: 'sending',
    attempts: 1,
    lastError: null,
    updatedAt: STALE,
    ...overrides,
  } as PushNotificationDelivery
}

// EM stub: `find` applies the `status IN (...)` + updatedAt<cutoff filter against the dataset (the
// sweep now covers BOTH `sending` and `pending`); `nativeUpdate` applies the same guard to one row,
// mutating it and reporting 1 when it wins the claim, else 0.
function makeEm(rows: PushNotificationDelivery[]) {
  return {
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>, options?: { limit?: number; orderBy?: { updatedAt?: 'asc' | 'desc' } }) => {
      const cutoff = (where.updatedAt as { $lt: Date }).$lt
      const statusFilter = where.status as { $in?: string[] } | string
      const statuses = typeof statusFilter === 'string' ? [statusFilter] : statusFilter.$in ?? []
      let matched = rows.filter((r) => statuses.includes(r.status) && r.updatedAt instanceof Date && r.updatedAt < cutoff)
      const direction = options?.orderBy?.updatedAt
      if (direction) {
        const sign = direction === 'desc' ? -1 : 1
        matched = [...matched].sort((a, b) => sign * (a.updatedAt!.getTime() - b.updatedAt!.getTime()))
      }
      if (typeof options?.limit === 'number') matched = matched.slice(0, options.limit)
      return matched
    }),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      const row = rows.find((r) => r.id === where.id)
      if (!row) return 0
      if (where.status !== undefined && row.status !== where.status) return 0
      const staleGuard = where.updatedAt as { $lt: Date } | undefined
      if (staleGuard && !(row.updatedAt instanceof Date && row.updatedAt < staleGuard.$lt)) return 0
      Object.assign(row, data)
      return 1
    }),
  }
}

beforeEach(() => {
  enqueueMock.mockClear()
  emitMock.mockClear()
  delete process.env.OM_PUSH_STUCK_RECLAIM_MINUTES
  delete process.env.OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT
})

describe('reclaimStuckPushDeliveries', () => {
  it('re-opens a stale sending row with remaining attempts and re-enqueues it', async () => {
    const row = makeRow({ id: 'stuck-1', attempts: 1, organizationId: 'org-9' })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 1, expired: 0 })
    expect(row.status).toBe('pending')
    expect(enqueueMock).toHaveBeenCalledWith({ deliveryId: 'stuck-1', tenantId: TENANT, organizationId: 'org-9' })
  })

  it('ignores a sending row that is still fresh (not past the stuck threshold)', async () => {
    const row = makeRow({ id: 'fresh-1', updatedAt: FRESH })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 0, expired: 0 })
    expect(row.status).toBe('sending')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('expires a stale row that has already exhausted its attempts (no re-enqueue)', async () => {
    const row = makeRow({ id: 'stuck-max', attempts: 3 })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 0, expired: 1 })
    expect(row.status).toBe('expired')
    expect(row.lastError).toBe('stuck_reclaimed')
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith(
      'push_notifications.delivery.failed',
      expect.not.objectContaining({ willRetry: true }),
      expect.any(Object),
    )
  })

  it('fails the row terminally when re-enqueue throws (never leaves it pending with no job)', async () => {
    enqueueMock.mockRejectedValueOnce(new Error('queue down'))
    const row = makeRow({ id: 'stuck-enq-fail', attempts: 0 })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 0, expired: 0 })
    expect(row.status).toBe('failed')
    expect(row.lastError).toContain('reclaim_enqueue_failed')
  })

  it('is a no-op for the row when it loses the atomic claim (another actor already moved it)', async () => {
    const row = makeRow({ id: 'raced', attempts: 1 })
    const em = makeEm([row])
    // Simulate a competing worker/tick flipping the row out of `sending` between find and nativeUpdate.
    em.nativeUpdate.mockResolvedValueOnce(0)

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 0, expired: 0 })
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('re-enqueues a stale pending row whose enqueue job was lost after the INSERT committed', async () => {
    // A `pending` row older than the window means the fan-out committed the row but the follow-up
    // enqueue never landed; the send-path claim only runs on a job, so no job ⇒ no claim. The sweep
    // must recover it exactly like a stuck `sending` row.
    const row = makeRow({ id: 'orphan-pending', status: 'pending', attempts: 1, organizationId: 'org-7' })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 1, expired: 0 })
    expect(row.status).toBe('pending')
    expect(enqueueMock).toHaveBeenCalledWith({ deliveryId: 'orphan-pending', tenantId: TENANT, organizationId: 'org-7' })
  })

  it('expires a stale pending row that has already exhausted its attempts (no re-enqueue)', async () => {
    const row = makeRow({ id: 'orphan-pending-max', status: 'pending', attempts: 3 })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 0, expired: 1 })
    expect(row.status).toBe('expired')
    expect(row.lastError).toBe('stuck_reclaimed')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('leaves a fresh pending row alone (a live in-flight fan-out is younger than the cutoff)', async () => {
    const row = makeRow({ id: 'fresh-pending', status: 'pending', updatedAt: FRESH, attempts: 0 })
    const em = makeEm([row])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 0, expired: 0 })
    expect(row.status).toBe('pending')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // The per-tick scan is batch-bounded (OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT) so a stranded backlog cannot
  // load an unbounded row set into memory. The oldest-stuck rows drain first; the remainder is left for
  // subsequent ticks.
  it('bounds the per-tick scan to the batch limit, draining the oldest-stuck rows first', async () => {
    process.env.OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT = '2'
    const oldest = makeRow({ id: 'old', updatedAt: new Date(NOW.getTime() - 30 * 60 * 1000), attempts: 1 })
    const middle = makeRow({ id: 'mid', updatedAt: new Date(NOW.getTime() - 20 * 60 * 1000), attempts: 1 })
    const newest = makeRow({ id: 'new', updatedAt: new Date(NOW.getTime() - 10 * 60 * 1000), attempts: 1 })
    // Seed out of order to prove the ordering is applied by the query, not insertion order.
    const em = makeEm([newest, oldest, middle])

    const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ reEnqueued: 2, expired: 0 })
    expect(oldest.status).toBe('pending')
    expect(middle.status).toBe('pending')
    expect(newest.status).toBe('sending')
    const reclaimedIds = enqueueMock.mock.calls.map(([job]) => job.deliveryId).sort()
    expect(reclaimedIds).toEqual(['mid', 'old'])
  })

  // The reclaim window floors at MIN_STUCK_MINUTES (1). `0`, negatives, and garbage all fall back to the
  // 5-minute default instead of `cutoff = now` — the old `0` meaning re-opened an actively-`sending` row
  // stamped at claim time and produced duplicate pushes.
  it.each(['0', '-3', 'not-a-number'])(
    'clamps OM_PUSH_STUCK_RECLAIM_MINUTES=%s to the default and does NOT reclaim an actively-sending fresh row',
    async (value) => {
      process.env.OM_PUSH_STUCK_RECLAIM_MINUTES = value
      // Stamped ~now (as at claim time); with the 5-minute default it is well inside the window.
      const row = makeRow({ id: 'in-flight', status: 'sending', updatedAt: new Date(NOW.getTime() - 1000), attempts: 1 })
      const em = makeEm([row])

      const result = await reclaimStuckPushDeliveries(em as never, { tenantId: TENANT }, NOW)

      expect(result).toEqual({ reEnqueued: 0, expired: 0 })
      expect(row.status).toBe('sending')
      expect(enqueueMock).not.toHaveBeenCalled()
    },
  )
})
