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

import {
  CustomerPurchaseApprovalServiceError,
  type CustomerPurchaseApprovalService,
} from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'
import { Cart, CartLine, CartMergeLog, CartPromotionApplication } from '../../data/entities'
import { emitCartEvent } from '../../events'
import {
  purgeExpiredCarts,
  releaseStaleCartLocks,
  sweepAbandonedCarts,
  sweepExpiredCarts,
  sweepExpiredProposals,
  type CartCodeServiceLike,
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
    channel: 'storefront',
    storeId: null,
    customerId: null,
    customerUserId: null,
    email: null,
    currencyCode: 'EUR',
    grandTotalGrossAmount: null,
    lastActivityAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    resolvedAt: null,
    lockedAt: null,
    lockExpiresAt: null,
    checkoutSessionId: null,
    proposedToCartId: null,
    approvalId: null,
    awaitingApprovalSince: null,
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

function makeCartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: `line-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT,
    organizationId: ORG,
    cartId: 'unset',
    deletedAt: null,
    ...overrides,
  } as CartLine
}

function makeCartPromotionApplication(overrides: Partial<CartPromotionApplication> = {}): CartPromotionApplication {
  return {
    id: `application-${Math.random().toString(36).slice(2)}`,
    tenantId: TENANT,
    organizationId: ORG,
    cartId: 'unset',
    promotionId: 'promotion-1',
    codeId: null,
    ...overrides,
  } as CartPromotionApplication
}

function makeCodeService(): jest.Mocked<CartCodeServiceLike> {
  return { releaseCode: jest.fn(async () => undefined) }
}

// Step 3.2 (K3) — a minimal `CustomerPurchaseApprovalService` double. Only
// `withdrawApproval` is exercised by the sweepers under test (`sweepExpiredCarts`'s and
// `purgeExpiredCarts`'s own pending-approval cleanup); every other method is unused here.
function makeApprovalService(): jest.Mocked<Pick<CustomerPurchaseApprovalService, 'withdrawApproval'>> {
  return { withdrawApproval: jest.fn(async () => ({}) as never) }
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
//
// (K11) `lines`/`applications` back `releaseCartCodeReservations`'s own reads
// (`CartLine` for K9's `lineCount`, `CartPromotionApplication` for the codes to release) —
// read-only tables for this stub, since the sweep under test never writes either.
function makeEm(
  initialCarts: Cart[],
  initialMergeLogs: CartMergeLog[] = [],
  initialLines: CartLine[] = [],
  initialApplications: CartPromotionApplication[] = [],
) {
  let carts = initialCarts
  let mergeLogs = initialMergeLogs
  const lines = initialLines
  const applications = initialApplications

  return {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>, options?: { limit?: number; orderBy?: Record<string, 'ASC' | 'DESC'>; fields?: string[] }) => {
      const table = entity === CartMergeLog ? mergeLogs : entity === CartLine ? lines : entity === CartPromotionApplication ? applications : carts
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

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(stale.status).toBe('abandoned')
    expect(stale.resolvedAt).toEqual(NOW)
    expect(stale.updatedAt).toEqual(NOW)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.abandoned',
      {
        cartId: 'stale-1',
        tenantId: TENANT,
        organizationId: ORG,
        storeId: null,
        channel: 'storefront',
        customerId: null,
        customerUserId: null,
        hasEmail: false,
        currencyCode: 'EUR',
        grandTotalGrossAmount: null,
        lineCount: 0,
        lastActivityAt: stale.lastActivityAt,
      },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  // K9: every field named by §11's rev-10 payload, with non-default values on every one
  // that has a meaningful default (`storeId`/`customerId`/`customerUserId` null,
  // `hasEmail` false, `grandTotalGrossAmount` null, `lineCount` 0) so this test actually
  // exercises the mapping rather than confirming defaults pass through unchanged. Never
  // the raw `email` string anywhere in the payload — only the derived `hasEmail` boolean.
  it('emits the full K9 payload shape, including a line count and hasEmail derived from the stored email', async () => {
    const richCart = makeCart({
      id: 'rich-1',
      lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      channel: 'pos',
      storeId: 'store-1',
      customerId: 'customer-1',
      customerUserId: 'customer-user-1',
      email: 'buyer@example.com',
      currencyCode: 'USD',
      grandTotalGrossAmount: '42.5000',
    })
    const lines = [
      makeCartLine({ cartId: 'rich-1' }),
      makeCartLine({ cartId: 'rich-1' }),
      makeCartLine({ cartId: 'other-cart' }),
    ]
    const em = makeEm([richCart], [], lines)

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.abandoned',
      {
        cartId: 'rich-1',
        tenantId: TENANT,
        organizationId: ORG,
        storeId: 'store-1',
        channel: 'pos',
        customerId: 'customer-1',
        customerUserId: 'customer-user-1',
        hasEmail: true,
        currencyCode: 'USD',
        grandTotalGrossAmount: '42.5000',
        lineCount: 2,
        lastActivityAt: richCart.lastActivityAt,
      },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
    const payload = emitMock.mock.calls[0][1] as Record<string, unknown>
    expect(payload.email).toBeUndefined()
  })

  it('leaves a basket with recent activity alone', async () => {
    const fresh = makeCart({ id: 'fresh-1', lastActivityAt: new Date(NOW.getTime() - 60 * 60 * 1000) })
    const em = makeEm([fresh])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

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

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

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

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('honors CART_INACTIVITY_WINDOW_HOURS when set', async () => {
    process.env.CART_INACTIVITY_WINDOW_HOURS = '1'
    const justOverOneHour = makeCart({ id: 'short-window-1', lastActivityAt: new Date(NOW.getTime() - 90 * 60 * 1000) })
    const em = makeEm([justOverOneHour])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

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

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(raceWon.status).toBe('abandoned')
    expect(raceWon.resolvedAt).toEqual(NOW)
    expect(emitMock).toHaveBeenCalledTimes(1)
    const [, raceWonPayload] = emitMock.mock.calls[0]
    expect((raceWonPayload as Record<string, unknown>).cartId).toBe('race-won')
  })

  // K11: the core new behaviour — every distinct code a transitioned basket still holds a
  // `CartPromotionApplication` reservation for gets released by `cartId`, exactly once per
  // code, via the injected `codeService` — never a static `promotions` entity import.
  it('releases every distinct code reservation on an abandoned basket, exactly once each', async () => {
    const stale = makeCart({ id: 'stale-codes-1', lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })
    const applications = [
      makeCartPromotionApplication({ cartId: 'stale-codes-1', codeId: 'code-1' }),
      // A second promotion's placeholder row referencing the SAME code (§4.3's own "a
      // code referenced by more than one promotion's rule tree resolves to all of them")
      // must not release twice.
      makeCartPromotionApplication({ cartId: 'stale-codes-1', codeId: 'code-1', promotionId: 'promotion-2' }),
      makeCartPromotionApplication({ cartId: 'stale-codes-1', codeId: 'code-2' }),
      makeCartPromotionApplication({ cartId: 'other-cart', codeId: 'code-should-not-release' }),
    ]
    const em = makeEm([stale], [], [], applications)
    const codeService = makeCodeService()

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, codeService, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(codeService.releaseCode).toHaveBeenCalledTimes(2)
    expect(codeService.releaseCode).toHaveBeenCalledWith(em, 'code-1', 'stale-codes-1', { tenantId: TENANT, organizationId: ORG })
    expect(codeService.releaseCode).toHaveBeenCalledWith(em, 'code-2', 'stale-codes-1', { tenantId: TENANT, organizationId: ORG })
  })

  it('never calls releaseCode for a basket with no code reservations', async () => {
    const stale = makeCart({ id: 'stale-no-codes-1', lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })
    const em = makeEm([stale])
    const codeService = makeCodeService()

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, codeService, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(codeService.releaseCode).not.toHaveBeenCalled()
  })

  it('does not let a failed code release block the event emission or the sweep tick', async () => {
    const stale = makeCart({ id: 'stale-release-fails-1', lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })
    const applications = [makeCartPromotionApplication({ cartId: 'stale-release-fails-1', codeId: 'code-1' })]
    const em = makeEm([stale], [], [], applications)
    const codeService = makeCodeService()
    codeService.releaseCode.mockRejectedValueOnce(new Error('promotions unavailable'))

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, codeService, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(stale.status).toBe('abandoned')
    expect(emitMock).toHaveBeenCalled()
  })

  // K5 (§9a.4/§9a.5/§12): "no abandonment while the buyer waits for approval" — a column
  // filter only, never a call into `customer_groups` (the whole point of the column).
  it('skips a basket whose awaiting_approval_since is set, even past the inactivity window', async () => {
    const awaitingApproval = makeCart({
      id: 'awaiting-approval-1',
      lastActivityAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      approvalId: 'approval-1',
      awaitingApprovalSince: new Date(NOW.getTime() - 60 * 60 * 1000),
    })
    const em = makeEm([awaitingApproval])

    const result = await sweepAbandonedCarts(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(awaitingApproval.status).toBe('active')
    expect(emitMock).not.toHaveBeenCalled()
  })
})

describe('sweepExpiredCarts', () => {
  it.each(['active', 'abandoned', 'locked'] as const)(
    'transitions a %s basket past its TTL to expired and emits cart.cart.expired',
    async (status) => {
      const expired = makeCart({ id: `expired-${status}`, status, expiresAt: new Date(NOW.getTime() - 1000) })
      const em = makeEm([expired])

      const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), null, NOW)

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

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), null, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(notYet.status).toBe('active')
  })

  it('ignores carts already converted or merged even past their TTL (not in the status set)', async () => {
    const converted = makeCart({ id: 'converted-1', status: 'converted', expiresAt: new Date(NOW.getTime() - 1000) })
    const merged = makeCart({ id: 'merged-1', status: 'merged', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([converted, merged])

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), null, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(converted.status).toBe('converted')
    expect(merged.status).toBe('merged')
  })

  it('never expires a proposal cart through this sweep (kind filter)', async () => {
    const proposal = makeCart({ id: 'proposal-exp-1', kind: 'proposal', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([proposal])

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), null, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(proposal.status).toBe('active')
  })

  // K11: same wiring as `sweepAbandonedCarts`, closing the Release 4 deferral this file
  // used to carry for `expire-carts` specifically.
  it('releases every distinct code reservation on an expired basket', async () => {
    const expired = makeCart({ id: 'expired-codes-1', expiresAt: new Date(NOW.getTime() - 1000) })
    const applications = [
      makeCartPromotionApplication({ cartId: 'expired-codes-1', codeId: 'code-1' }),
      makeCartPromotionApplication({ cartId: 'other-cart', codeId: 'code-should-not-release' }),
    ]
    const em = makeEm([expired], [], [], applications)
    const codeService = makeCodeService()

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, codeService, null, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(codeService.releaseCode).toHaveBeenCalledTimes(1)
    expect(codeService.releaseCode).toHaveBeenCalledWith(em, 'code-1', 'expired-codes-1', { tenantId: TENANT, organizationId: ORG })
  })

  it('never calls releaseCode for an expiring basket with no code reservations', async () => {
    const expired = makeCart({ id: 'expired-no-codes-1', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([expired])
    const codeService = makeCodeService()

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, codeService, null, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(codeService.releaseCode).not.toHaveBeenCalled()
  })

  // Regression check (unchanged by this Step): a racing tenant's own candidates and
  // transitions never cross into this tenant's tick, same scoping every sweep in this
  // file already enforces via `scope.tenantId` on every `find`/`nativeUpdate`.
  it('never transitions or releases codes for a basket under a different tenant', async () => {
    const otherTenantCart = makeCart({
      id: 'other-tenant-1',
      tenantId: 'tenant-other',
      organizationId: 'org-other',
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([otherTenantCart])
    const codeService = makeCodeService()

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, codeService, null, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(otherTenantCart.status).toBe('active')
    expect(codeService.releaseCode).not.toHaveBeenCalled()
  })

  // K3 (§9/§9a.4): "cart expiry ends a request earlier than the 14-day approval expiry" —
  // a pending approval on an expiring basket is withdrawn, system actor, and
  // `awaiting_approval_since` is cleared in the same tick.
  it('withdraws a pending approval on an expiring basket and clears awaiting_approval_since', async () => {
    const expired = makeCart({
      id: 'expired-pending-approval-1',
      expiresAt: new Date(NOW.getTime() - 1000),
      approvalId: 'approval-1',
      awaitingApprovalSince: new Date(NOW.getTime() - 60 * 60 * 1000),
    })
    const em = makeEm([expired])
    const approvalService = makeApprovalService()

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), approvalService as never, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(approvalService.withdrawApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      approvalId: 'approval-1',
      actor: { actorType: 'system', reason: 'cart_expired' },
    })
    expect(expired.awaitingApprovalSince).toBeNull()
  })

  it('leaves awaiting_approval_since alone when the approval is no longer pending (already settled by a race)', async () => {
    const expired = makeCart({
      id: 'expired-already-settled-1',
      expiresAt: new Date(NOW.getTime() - 1000),
      approvalId: 'approval-1',
      awaitingApprovalSince: null,
    })
    const em = makeEm([expired])
    const approvalService = makeApprovalService()
    approvalService.withdrawApproval.mockRejectedValueOnce(
      new CustomerPurchaseApprovalServiceError('approval_not_pending', '[internal] not pending'),
    )

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), approvalService as never, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(expired.awaitingApprovalSince).toBeNull()
  })

  it('never calls withdrawApproval for a basket with no approvalId', async () => {
    const expired = makeCart({ id: 'expired-no-approval-1', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([expired])
    const approvalService = makeApprovalService()

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), approvalService as never, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(approvalService.withdrawApproval).not.toHaveBeenCalled()
  })

  it('does not let a failed approval withdrawal block the sweep tick', async () => {
    const expired = makeCart({
      id: 'expired-withdraw-fails-1',
      expiresAt: new Date(NOW.getTime() - 1000),
      approvalId: 'approval-1',
      awaitingApprovalSince: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([expired])
    const approvalService = makeApprovalService()
    approvalService.withdrawApproval.mockRejectedValueOnce(new Error('customer_groups unavailable'))

    const result = await sweepExpiredCarts(em as never, { tenantId: TENANT }, makeCodeService(), approvalService as never, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(expired.status).toBe('expired')
  })
})

// Step 3.4 (K15/S15, §7a.3) — the proposal expiry branch, run on the SAME hourly tick as
// `sweepExpiredCarts` (see `workers/expire.worker.ts`'s call site) but its OWN function/WHERE.
describe('sweepExpiredProposals', () => {
  it('transitions a live proposal past its OWN expires_at to expired, sets resolvedAt, and emits cart.proposal.expired with scope', async () => {
    const proposal = makeCart({
      id: 'proposal-expiring-1',
      kind: 'proposal',
      proposedToCartId: 'target-1',
      status: 'active',
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([proposal])

    const result = await sweepExpiredProposals(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(proposal.status).toBe('expired')
    expect(proposal.resolvedAt).toEqual(NOW)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.proposal.expired',
      { proposalCartId: 'proposal-expiring-1', targetCartId: 'target-1' },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  it('leaves a live proposal before its own expires_at alone', async () => {
    const proposal = makeCart({
      id: 'proposal-not-yet-1',
      kind: 'proposal',
      proposedToCartId: 'target-1',
      status: 'active',
      expiresAt: new Date(NOW.getTime() + 1000),
    })
    const em = makeEm([proposal])

    const result = await sweepExpiredProposals(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(proposal.status).toBe('active')
  })

  it('never touches a basket-kind cart, even one past its own expires_at (kind filter)', async () => {
    const basket = makeCart({ id: 'basket-1', kind: 'basket', status: 'active', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([basket])

    const result = await sweepExpiredProposals(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(basket.status).toBe('active')
  })

  it('never touches an already-resolved proposal (merged/abandoned/expired) even past expires_at (status filter)', async () => {
    const alreadyMerged = makeCart({
      id: 'proposal-already-merged-1',
      kind: 'proposal',
      status: 'merged',
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([alreadyMerged])

    const result = await sweepExpiredProposals(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(alreadyMerged.status).toBe('merged')
  })

  it('releases code reservations by cartId for an expiring proposal (K11 parity — finds nothing in Release 5, S14, but the rule stays correct)', async () => {
    const proposal = makeCart({ id: 'proposal-codes-1', kind: 'proposal', status: 'active', expiresAt: new Date(NOW.getTime() - 1000) })
    const applications = [makeCartPromotionApplication({ cartId: 'proposal-codes-1', codeId: 'code-1' })]
    const em = makeEm([proposal], [], [], applications)
    const codeService = makeCodeService()

    const result = await sweepExpiredProposals(em as never, { tenantId: TENANT }, codeService, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(codeService.releaseCode).toHaveBeenCalledWith(em, 'code-1', 'proposal-codes-1', { tenantId: TENANT, organizationId: ORG })
  })

  it('never transitions a proposal under a different tenant', async () => {
    const otherTenantProposal = makeCart({
      id: 'proposal-other-tenant-1',
      tenantId: 'tenant-other',
      organizationId: 'org-other',
      kind: 'proposal',
      status: 'active',
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([otherTenantProposal])

    const result = await sweepExpiredProposals(em as never, { tenantId: TENANT }, makeCodeService(), NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(otherTenantProposal.status).toBe('active')
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

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

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

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('leaves an unresolved basket alone (resolvedAt IS NULL never matches)', async () => {
    const unresolved = makeCart({ id: 'unresolved-1', status: 'active', resolvedAt: null })
    const em = makeEm([unresolved])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

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

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.purged',
      { cartId: 'free-to-purge', kind: 'basket', proposedToCartId: null },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  // Step 3.4 (K15/S15, §16 Q6) — "Covers kind = 'proposal' as well: rejected and expired
  // proposals purge 90 days after resolved_at." Replaces the pre-Step-3.4 "kind filter"
  // test above this one, which asserted the OPPOSITE (deliberately deferred posture, now
  // superseded).
  it('hard-deletes a rejected proposal (status abandoned) resolved more than 90 days ago, same as a basket', async () => {
    const rejectedProposal = makeCart({
      id: 'proposal-purge-1',
      kind: 'proposal',
      proposedToCartId: 'some-target',
      status: 'abandoned',
      resolvedAt: RESOLVED_91_DAYS_AGO,
    })
    const em = makeEm([rejectedProposal])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(emitMock).toHaveBeenCalledWith(
      'cart.cart.purged',
      { cartId: 'proposal-purge-1', kind: 'proposal', proposedToCartId: 'some-target' },
      { persistent: true, tenantId: TENANT, organizationId: ORG },
    )
  })

  it('hard-deletes an EXPIRED proposal resolved more than 90 days ago, same as a basket', async () => {
    const expiredProposal = makeCart({
      id: 'proposal-purge-2',
      kind: 'proposal',
      proposedToCartId: 'some-target',
      status: 'expired',
      resolvedAt: RESOLVED_91_DAYS_AGO,
    })
    const em = makeEm([expiredProposal])

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

    expect(result).toEqual({ transitioned: 1 })
  })

  it('keeps an ACCEPTED proposal alive while CartMergeLog.proposalCartId still references it, even past the retention window', async () => {
    const acceptedProposal = makeCart({
      id: 'proposal-accepted-1',
      kind: 'proposal',
      proposedToCartId: 'target-1',
      status: 'merged',
      resolvedAt: RESOLVED_91_DAYS_AGO,
    })
    const mergeLogs = [makeMergeLog({ sourceCartId: 'proposal-accepted-1', targetCartId: 'target-1', strategy: 'manual', proposalCartId: 'proposal-accepted-1' })]
    const em = makeEm([acceptedProposal], mergeLogs)

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, null, NOW)

    expect(result).toEqual({ transitioned: 0 })
    expect(emitMock).not.toHaveBeenCalled()
  })

  // K3 (§12): "Withdraws a pending approval left on a purged basket (normally already
  // withdrawn at expiry)" — the one path that reaches purge with a still-pending approval
  // is a cart `markConverted`/`merge` resolved directly, bypassing `expire-carts` first.
  it('withdraws a pending approval before hard-deleting a purged basket', async () => {
    const old = makeCart({
      id: 'old-pending-approval-1',
      status: 'converted',
      resolvedAt: RESOLVED_91_DAYS_AGO,
      approvalId: 'approval-1',
      awaitingApprovalSince: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([old])
    const approvalService = makeApprovalService()

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, approvalService as never, NOW)

    expect(result).toEqual({ transitioned: 1 })
    expect(approvalService.withdrawApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT, organizationId: ORG },
      approvalId: 'approval-1',
      actor: { actorType: 'system', reason: 'cart_purged' },
    })
  })

  it('does not let a failed approval withdrawal block the purge', async () => {
    const old = makeCart({
      id: 'old-withdraw-fails-1',
      status: 'expired',
      resolvedAt: RESOLVED_91_DAYS_AGO,
      approvalId: 'approval-1',
    })
    const em = makeEm([old])
    const approvalService = makeApprovalService()
    approvalService.withdrawApproval.mockRejectedValueOnce(new Error('customer_groups unavailable'))

    const result = await purgeExpiredCarts(em as never, { tenantId: TENANT }, approvalService as never, NOW)

    expect(result).toEqual({ transitioned: 1 })
  })
})
