// findWithDecryption is mocked to a thin pass-through so these tests exercise the sweep's own
// query/transition logic against a fake EntityManager, not the real tenant-encryption pipeline
// (which the module's other command tests avoid the same way — see
// `commands/__tests__/cart.test.ts`'s `findOneWithDecryption` mock).
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (em: any, entity: any, where: any, options: any) => em.find(entity, where, options),
}))

jest.mock('../../events', () => ({
  emitCartEvent: jest.fn(async () => undefined),
}))

import { Cart, CartMergeLog } from '../../data/entities'
import { emitCartEvent } from '../../events'
import {
  purgeExpiredCarts,
  releaseStaleCartLocks,
  sweepAbandonedCarts,
  sweepExpiredCarts,
} from '../sweepers'

const emitMock = emitCartEvent as jest.MockedFunction<typeof emitCartEvent>

const TENANT = 'tenant-cart-sweep-1'
const ORG = 'org-cart-sweep-1'
const NOW = new Date('2026-10-15T12:00:00.000Z')

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: `cart-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT,
    organizationId: ORG,
    kind: 'basket',
    status: 'active',
    lastActivityAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    resolvedAt: null,
    lockedAt: null,
    lockExpiresAt: null,
    checkoutSessionId: null,
    proposedToCartId: null,
    updatedAt: NOW,
    ...overrides,
  } as Cart
}

function makeMergeLog(overrides: Partial<CartMergeLog> = {}): CartMergeLog {
  return {
    id: `merge-log-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT,
    organizationId: ORG,
    sourceCartId: 'unused-source',
    targetCartId: 'unused-target',
    proposalCartId: null,
    strategy: 'sum',
    sourceSnapshot: [],
    outcome: [],
    mergedByActorType: 'buyer',
    mergedByActorId: null,
    createdAt: NOW,
    ...overrides,
  } as CartMergeLog
}

// Evaluates one MikroORM-style filter value ($in/$lt/$gt/$ne, ANDed when combined on one key).
function matchesValue(actual: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(([op, opValue]) => {
      switch (op) {
        case '$in':
          return (opValue as unknown[]).includes(actual)
        case '$lt':
          return actual instanceof Date && opValue instanceof Date && actual < opValue
        case '$gt':
          return actual instanceof Date && opValue instanceof Date && actual > opValue
        case '$ne':
          return actual !== opValue
        default:
          return true
      }
    })
  }
  return actual === condition
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === '$and') return (value as Record<string, unknown>[]).every((clause) => matchesWhere(row, clause))
    if (key === '$or') return (value as Record<string, unknown>[]).some((clause) => matchesWhere(row, clause))
    return matchesValue(row[key], value)
  })
}

// Minimal EM stub shared by all four sweeps: `find` filters the right in-memory table by the
// exact WHERE shape the sweep under test issues; `nativeUpdate`/`nativeDelete` apply the same
// guard to the matching rows. Mirrors
// push_notifications/lib/__tests__/push-reaper.test.ts's own `makeEm` helper.
function makeEm(initialCarts: Cart[], initialMergeLogs: CartMergeLog[] = []) {
  let carts = initialCarts
  let mergeLogs = initialMergeLogs

  return {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>, options?: { limit?: number; orderBy?: Record<string, 'ASC' | 'DESC'>; fields?: string[] }) => {
      const table = entity === CartMergeLog ? mergeLogs : carts
      let matched = table.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
      if (options?.orderBy) {
        const entries = Object.entries(options.orderBy)
        matched = [...matched].sort((a: any, b: any) => {
          for (const [field, dir] of entries) {
            const av = a[field]
            const bv = b[field]
            let cmp = 0
            if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime()
            else if (av < bv) cmp = -1
            else if (av > bv) cmp = 1
            if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp
          }
          return 0
        })
      }
      if (typeof options?.limit === 'number') matched = matched.slice(0, options.limit)
      return matched
    }),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      const table = entity === CartMergeLog ? mergeLogs : carts
      const matched = table.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
      for (const row of matched) Object.assign(row, data)
      return matched.length
    }),
    nativeDelete: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const table = entity === CartMergeLog ? mergeLogs : carts
      const matched = table.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
      const matchedIds = new Set(matched.map((row) => (row as unknown as { id: string }).id))
      if (entity === CartMergeLog) mergeLogs = mergeLogs.filter((row) => !matchedIds.has(row.id))
      else carts = carts.filter((row) => !matchedIds.has(row.id))
      return matched.length
    }),
  }
}

beforeEach(() => {
  emitMock.mockClear()
  delete process.env.CART_INACTIVITY_WINDOW_HOURS
  delete process.env.CART_LOCK_TIMEOUT_MINUTES
})

describe('sweepAbandonedCarts', () => {
  it('transitions an active basket past the inactivity window to abandoned and emits cart.cart.abandoned', async () => {
    const stale = makeCart({ id: 'stale-1', lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })
    const em = makeEm([stale])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(stale.status).toBe('abandoned')
    expect(stale.resolvedAt).toEqual(NOW)
    expect(stale.updatedAt).toEqual(NOW)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.abandoned',
      { cartId: 'stale-1' },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  it('leaves a basket with recent activity alone', async () => {
    const fresh = makeCart({ id: 'fresh-1', lastActivityAt: new Date(NOW.getTime() - 60 * 60 * 1000) })
    const em = makeEm([fresh])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(fresh.status).toBe('active')
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('never abandons a proposal cart by inactivity (kind filter, §7a.1)', async () => {
    const proposal = makeCart({
      id: 'proposal-1',
      kind: 'proposal',
      lastActivityAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    })
    const em = makeEm([proposal])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(proposal.status).toBe('active')
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('ignores a basket that already left active (idempotent against retries)', async () => {
    const alreadyAbandoned = makeCart({
      id: 'already-1',
      status: 'abandoned',
      lastActivityAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
    })
    const em = makeEm([alreadyAbandoned])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('honors CART_INACTIVITY_WINDOW_HOURS when set', async () => {
    process.env.CART_INACTIVITY_WINDOW_HOURS = '1'
    const justOverOneHour = makeCart({ id: 'short-window-1', lastActivityAt: new Date(NOW.getTime() - 90 * 60 * 1000) })
    const em = makeEm([justOverOneHour])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(justOverOneHour.status).toBe('abandoned')
  })

  it('does not emit a duplicate event for a cart a racing tick already transitioned before this call\'s nativeUpdate runs', async () => {
    const raceLost = makeCart({ id: 'race-lost', lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })
    const raceWon = makeCart({ id: 'race-won', lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })
    const em = makeEm([raceLost, raceWon])

    // Simulates a second tick's `nativeUpdate` landing between this call's candidate read
    // and its own `nativeUpdate`: by the time THIS call's `nativeUpdate` runs, `raceLost` no
    // longer matches `status: 'active'`, so this call never transitions it — but a
    // pre-fix implementation still looped over every pre-fetched candidate and would have
    // emitted `cart.cart.abandoned` for it anyway (the bug this test guards against).
    const originalFind = em.find.getMockImplementation()!
    em.find.mockImplementationOnce(async (...args: Parameters<typeof originalFind>) => {
      const result = await originalFind(...args)
      raceLost.status = 'abandoned'
      raceLost.resolvedAt = new Date(NOW.getTime() - 1000)
      return result
    })

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(raceWon.status).toBe('abandoned')
    expect(raceWon.resolvedAt).toEqual(NOW)
    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.abandoned',
      { cartId: 'race-won' },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })
})

describe('sweepExpiredCarts', () => {
  it.each(['active', 'abandoned', 'locked'] as const)(
    'transitions a %s basket past its TTL to expired and emits cart.cart.expired',
    async (status) => {
      const expired = makeCart({ id: `expired-${status}`, status, expiresAt: new Date(NOW.getTime() - 1000) })
      const em = makeEm([expired])

      const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, NOW)

      expect(result).toEqual({ transitioned: 1 })
      expect(expired.status).toBe('expired')
      expect(expired.resolvedAt).toEqual(NOW)
      expect(emitMock).toHaveBeenCalledWith(
        'cart.cart.expired',
        { cartId: `expired-${status}` },
        { persistent: true, tenantId: TENANT, organizationId: ORG },
      )
    },
  )

  it('leaves a basket that has not reached its TTL alone', async () => {
    const notYet = makeCart({ id: 'not-yet-1', expiresAt: new Date(NOW.getTime() + 1000) })
    const em = makeEm([notYet])

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(notYet.status).toBe('active')
  })

  it('ignores carts already converted or merged even past their TTL (not in the status set)', async () => {
    const converted = makeCart({ id: 'converted-1', status: 'converted', expiresAt: new Date(NOW.getTime() - 1000) })
    const merged = makeCart({ id: 'merged-1', status: 'merged', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([converted, merged])

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(converted.status).toBe('converted')
    expect(merged.status).toBe('merged')
  })

  it('never expires a proposal cart through this sweep (kind filter)', async () => {
    const proposal = makeCart({ id: 'proposal-exp-1', kind: 'proposal', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([proposal])

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(proposal.status).toBe('active')
  })
})

describe('releaseStaleCartLocks', () => {
  it('returns a locked cart past its lock timeout to active and clears the lock columns', async () => {
    const locked = makeCart({
      id: 'locked-1',
      status: 'locked',
      lockedAt: new Date(NOW.getTime() - 40 * 60 * 1000),
      lockExpiresAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      checkoutSessionId: 'session-abc',
    })
    const em = makeEm([locked])

    const result = await releaseStaleCartLocks(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(locked.status).toBe('active')
    expect(locked.lockedAt).toBeNull()
    expect(locked.lockExpiresAt).toBeNull()
    expect(locked.checkoutSessionId).toBeNull()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('leaves a lock alone before its timeout', async () => {
    const stillLocked = makeCart({
      id: 'still-locked-1',
      status: 'locked',
      lockExpiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
    })
    const em = makeEm([stillLocked])

    const result = await releaseStaleCartLocks(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(stillLocked.status).toBe('locked')
  })

  it('releases a stale lock on a proposal-kind row too — no kind filter, per spec (a proposal never actually gets locked, so this never matters in practice)', async () => {
    const lockedProposal = makeCart({
      id: 'locked-proposal-1',
      kind: 'proposal',
      status: 'locked',
      lockExpiresAt: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([lockedProposal])

    const result = await releaseStaleCartLocks(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(lockedProposal.status).toBe('active')
  })
})

describe('purgeExpiredCarts', () => {
  const RESOLVED_91_DAYS_AGO = new Date(NOW.getTime() - 91 * 24 * 60 * 60 * 1000)
  const RESOLVED_10_DAYS_AGO = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)

  it('hard-deletes a basket resolved more than 90 days ago and emits cart.cart.purged', async () => {
    const old = makeCart({ id: 'old-1', status: 'expired', resolvedAt: RESOLVED_91_DAYS_AGO })
    const em = makeEm([old])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect((em.find as jest.Mock).mock.calls.length).toBeGreaterThan(0)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.purged',
      { cartId: 'old-1', kind: 'basket', proposedToCartId: null },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  it('leaves a basket resolved within the retention window alone', async () => {
    const recent = makeCart({ id: 'recent-1', status: 'expired', resolvedAt: RESOLVED_10_DAYS_AGO })
    const em = makeEm([recent])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('leaves an unresolved basket alone (resolvedAt IS NULL never matches)', async () => {
    const unresolved = makeCart({ id: 'unresolved-1', status: 'active', resolvedAt: null })
    const em = makeEm([unresolved])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
  })

  it('excludes a cart CartMergeLog still references as source/target/proposal, even though otherwise eligible', async () => {
    const stillSource = makeCart({ id: 'referenced-source', status: 'merged', resolvedAt: RESOLVED_91_DAYS_AGO })
    const stillTarget = makeCart({ id: 'referenced-target', status: 'expired', resolvedAt: RESOLVED_91_DAYS_AGO })
    const stillProposal = makeCart({ id: 'referenced-proposal', status: 'merged', resolvedAt: RESOLVED_91_DAYS_AGO })
    const unreferenced = makeCart({ id: 'free-to-purge', status: 'expired', resolvedAt: RESOLVED_91_DAYS_AGO })
    const mergeLogs = [
      makeMergeLog({ sourceCartId: 'referenced-source', targetCartId: 'some-other-cart' }),
      makeMergeLog({ sourceCartId: 'some-other-cart', targetCartId: 'referenced-target' }),
      makeMergeLog({ sourceCartId: 'some-other-cart', targetCartId: 'another-cart', proposalCartId: 'referenced-proposal' }),
    ]
    const em = makeEm([stillSource, stillTarget, stillProposal, unreferenced], mergeLogs)

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.purged',
      { cartId: 'free-to-purge', kind: 'basket', proposedToCartId: null },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  it('never purges a proposal-kind cart through this sweep (kind filter)', async () => {
    const proposal = makeCart({ id: 'proposal-purge-1', kind: 'proposal', status: 'expired', resolvedAt: RESOLVED_91_DAYS_AGO })
    const em = makeEm([proposal])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ transitioned: 0 })
  })
})
