/**
 * Real-command PostgreSQL proof for the login-merge sibling of #9183 scenario 2: a guest
 * cart merged into the buyer's cart (`cart.merge` with a `sourceToken`, then its own
 * `cart.reprice`) racing a checkout lock (`cart.lock`) on that buyer's cart. Every command
 * is the real registered handler, dispatched through the real `CommandBus`; see
 * `support/cartCommandRaceHarness.ts` for which peers are real and which are stubbed.
 *
 * The guards under test, all in production code:
 * - `commands/merge.ts` (guest merge): inside its transaction it takes `cart:lines` for both
 *   carts (`acquireCartLineLocks`), re-reads both, refuses a locked target with
 *   `423 cart_locked`, and only then applies the merge transitions;
 * - `commands/lock.ts#lockCartCommand`: under `cart:lines:<cartId>` it recomputes totals and
 *   `requiresApproval` from the lines it reads, so stored totals a merge left behind before
 *   its own re-price never decide the approval gate.
 *
 * Interleavings, pinned with checkpoints:
 * 1. the lock holds the cart lock (paused in its approval read) when the merge arrives: the
 *    merge waits, is refused once the lock commits, and nothing is merged;
 * 2. the merge committed its lines but its re-price has not run when the lock takes the cart:
 *    the lock judges the merged lines and refuses an approval that only covered the cart
 *    before the merge.
 *
 * Runs in the `test:pg-integration` CI job (`OM_PG_INTEGRATION=1`, own disposable
 * Postgres container), or against a throwaway database named by `OM_CART_PG_URL`.
 */
import { randomUUID } from 'node:crypto'
import type { CartLockInput, CartLockResult } from '../lock'
import type { CartMergeInput, CartMergeResult } from '../merge'
import {
  cartRacesRunAgainstPostgres,
  expectFulfilled,
  expectHttpRejection,
  reachedBy,
  startCartRaceHarness,
  track,
  type CartRaceHarness,
  type SeededCart,
  type TenantScope,
} from './support/cartCommandRaceHarness'

const describeWithPostgres = cartRacesRunAgainstPostgres ? describe : describe.skip

describeWithPostgres('cart.merge (login) vs a checkout cart.lock through the real commands (#9183)', () => {
  jest.setTimeout(120_000)
  let harness: CartRaceHarness | undefined

  function races(): CartRaceHarness {
    if (!harness) throw new Error('[internal] cart race harness is not started')
    return harness
  }

  beforeAll(async () => {
    harness = await startCartRaceHarness('cart-login-merge-vs-lock')
  }, 120_000)

  afterEach(async () => {
    expect((await harness?.releaseAll()) ?? []).toEqual([])
  })

  afterAll(async () => {
    await harness?.close()
  })

  function lockCart(scope: TenantScope, cart: SeededCart, checkoutSessionId: string): Promise<CartLockResult> {
    return races().run<CartLockInput, CartLockResult>(
      'cart.lock',
      {
        cartId: cart.cartId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        checkoutSessionId,
        routeContext: cart.routeContext,
      },
      scope,
    )
  }

  function mergeGuestCart(scope: TenantScope, target: SeededCart, guestToken: string): Promise<CartMergeResult> {
    return races().run<CartMergeInput, CartMergeResult>(
      'cart.merge',
      {
        targetCartId: target.cartId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        sourceToken: guestToken,
        routeContext: target.routeContext,
      },
      scope,
    )
  }

  function goodsGross(totals: Record<string, unknown>): number {
    return Number(totals.grandTotalGrossAmount)
  }

  // Buyer cart: 2 x 12.00 gross. Guest cart, same store: 1 more of the same line, which the
  // merge sums into it (3 x 12.00 = 36.00).
  async function seedBuyerAndGuestCarts(scope: TenantScope, approvedAmountGross: number) {
    const product = await races().seedPricedProduct(scope)
    const target = await races().seedBasketCart(scope, [{ product, quantity: 2 }], {
      approval: { approvalRequiredAbove: 10, approvedAmountGross },
    })
    const guestToken = randomUUID()
    const guest = await races().seedBasketCart(scope, [{ product, quantity: 1 }], {
      storeId: target.routeContext.storeId,
      token: guestToken,
    })
    return { target, guest, guestToken }
  }

  test('a merge arriving while cart.lock holds the cart lock waits for it and is refused; nothing is merged', async () => {
    const scope = races().newTenant()
    const { target, guest, guestToken } = await seedBuyerAndGuestCarts(scope, 100)
    const checkoutSessionId = randomUUID()

    const lockPausedInGate = races().checkpoints.arm('approval.getApproval')
    const lock = track(lockCart(scope, target, checkoutSessionId))
    await reachedBy(lockPausedInGate, lock)

    const merge = track(mergeGuestCart(scope, target, guestToken))
    await races().waitForLockWaiters('any', target.cartId, 1, merge)
    expect(merge.isSettled()).toBe(false)

    lockPausedInGate.release()
    expect(expectFulfilled(await lock.settled).extended).toBe(false)
    const refusal = expectHttpRejection(await merge.settled)
    expect(refusal.status).toBe(423)
    expect(refusal.body).toMatchObject({ code: 'cart_locked', checkoutSessionId })

    const lockedTarget = await races().readCart(target.cartId)
    expect(lockedTarget.status).toBe('locked')
    expect(goodsGross(lockedTarget.totals)).toBe(24)
    const lockedLines = await races().readActiveLines(target.cartId)
    expect(lockedLines.map((line) => [line.id, Number(line.quantity)])).toEqual([[target.lineIds[0], 2]])
    const storedGuest = await races().readCart(guest.cartId)
    expect(storedGuest.status).toBe('active')
    expect(storedGuest.mergedIntoCartId ?? null).toBeNull()
    expect(await races().countMergeLogs(target.cartId)).toBe(0)
  })

  test('a checkout lock taken after a merge committed, before its re-price, refuses the merged cart above its approval', async () => {
    const scope = races().newTenant()
    const { target, guest, guestToken } = await seedBuyerAndGuestCarts(scope, 30)
    const checkoutSessionId = randomUUID()

    const lockPausedAfterReprice = races().checkpoints.arm('after:cart.reprice')
    const lock = track(lockCart(scope, target, checkoutSessionId))
    await reachedBy(lockPausedAfterReprice, lock)

    // The lock already passed its own `before:cart.reprice`; the next dispatch is the merge's.
    const mergeRepricePaused = races().checkpoints.arm('before:cart.reprice')
    const merge = track(mergeGuestCart(scope, target, guestToken))
    await reachedBy(mergeRepricePaused, merge)
    expect(goodsGross((await races().readCart(target.cartId)).totals)).toBe(24)
    expect((await races().readActiveLines(target.cartId)).map((line) => Number(line.quantity))).toEqual([3])

    lockPausedAfterReprice.release()
    const lockOutcome = await lock.settled
    mergeRepricePaused.release()
    expect(expectFulfilled(await merge.settled).mergeSummary.counts).toMatchObject({ summed: 1 })

    const refusal = expectHttpRejection(lockOutcome)
    expect(refusal).toEqual({
      status: 409,
      body: expect.objectContaining({ code: 'cart_requires_approval', amountGross: '36' }),
    })
    const finalTarget = await races().readCart(target.cartId)
    expect(finalTarget.status).toBe('active')
    expect(goodsGross(finalTarget.totals)).toBe(36)
    expect((await races().readCart(guest.cartId)).status).toBe('merged')
  })
})
