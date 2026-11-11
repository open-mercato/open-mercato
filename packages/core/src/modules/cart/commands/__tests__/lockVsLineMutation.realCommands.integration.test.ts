/**
 * Real-command PostgreSQL proof for #9183 scenario 1 (inherited #8268 blocker): the
 * checkout lock (`cart.lock`) racing a buyer's line write (`cart.lines.update` /
 * `cart.lines.remove`) on the same cart. Every command is the real registered handler,
 * dispatched through the real `CommandBus`; see `support/cartCommandRaceHarness.ts` for
 * exactly which peers are real (pricing, sales calculation, customer_groups terms and
 * approvals, catalog visibility) and which are stubbed or absent (promotions evaluator,
 * dataEngine sink, audit log, cache, event bus), and why none of those can mask a lock bug.
 *
 * The guards under test, all in production code:
 * - `commands/lines.ts#buildCartLineMutationGuardPhases`: every line write takes
 *   `pg_advisory_xact_lock('cart:lines:<cartId>')` inside its transaction, then re-reads
 *   the cart and refuses a cart that is no longer `active`.
 * - `commands/lock.ts#lockCartCommand`: the `active -> locked` write takes the SAME key,
 *   re-runs its gate (`assertLockGate`: fresh cart, fresh lines, approval) under it, and
 *   transitions with a conditional `nativeUpdate` guarded on `status = 'active'`.
 *
 * Each test pins one interleaving with checkpoints at real call boundaries and checks the
 * resulting rows, so the outcome cannot depend on scheduler luck:
 * 1. a line write already inside its transaction makes the lock wait, and the lock's gate
 *    then judges the cart as that write left it: a quantity raise past the approved amount
 *    is refused, and removing the cart's unavailable line lets the lock through;
 * 2. a lock already inside its transaction makes a line write wait, and the write is then
 *    refused without touching the line;
 * 3. a line write that passed its pre-checks before the lock committed is refused by its
 *    in-transaction re-check.
 *
 * Runs in the `test:pg-integration` CI job (`OM_PG_INTEGRATION=1`, own disposable
 * Postgres container), or against a throwaway database named by `OM_CART_PG_URL`.
 */
import { randomUUID } from 'node:crypto'
import type { CartLockInput, CartLockResult } from '../lock'
import type {
  CartLinesRemoveInput,
  CartLinesRemoveResult,
  CartLinesUpdateInput,
  CartLinesUpdateOutcome,
} from '../lines'
import {
  cartRacesRunAgainstPostgres,
  expectFulfilled,
  expectHttpRejection,
  reachedBy,
  startCartRaceHarness,
  track,
  type CartRaceHarness,
  type SeededCart,
  type Settled,
  type TenantScope,
} from './support/cartCommandRaceHarness'

const describeWithPostgres = cartRacesRunAgainstPostgres ? describe : describe.skip

describeWithPostgres('cart.lock vs cart.lines.update/.remove through the real commands (#9183 scenario 1)', () => {
  jest.setTimeout(120_000)
  let harness: CartRaceHarness | undefined

  function races(): CartRaceHarness {
    if (!harness) throw new Error('[internal] cart race harness is not started')
    return harness
  }

  beforeAll(async () => {
    harness = await startCartRaceHarness('cart-lock-vs-line-mutation')
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

  function updateLine(scope: TenantScope, cart: SeededCart, lineId: string, quantity: number): Promise<CartLinesUpdateOutcome> {
    return races().run<CartLinesUpdateInput, CartLinesUpdateOutcome>(
      'cart.lines.update',
      { routeContext: cart.routeContext, cartId: cart.cartId, lineId, quantity },
      scope,
    )
  }

  function removeLine(scope: TenantScope, cart: SeededCart, lineId: string): Promise<CartLinesRemoveResult> {
    return races().run<CartLinesRemoveInput, CartLinesRemoveResult>(
      'cart.lines.remove',
      { routeContext: cart.routeContext, cartId: cart.cartId, lineId },
      scope,
    )
  }

  // `buildCartLineMutationGuardPhases` checks `status !== 'active'` before
  // `assertCartNotLocked`, so the in-transaction refusal of a locked cart currently answers
  // `409 cart_not_active { status: 'locked' }`, while the pre-transaction `loadMutableCart`
  // check answers `423 cart_locked`. Either refusal keeps the line untouched (what these
  // tests prove); the 409/423 split is reported separately on #9183.
  function expectRefusedBecauseLocked(outcome: Settled<unknown>, checkoutSessionId: string): void {
    const refusal = expectHttpRejection(outcome)
    if (refusal.status === 423) {
      expect(refusal.body).toMatchObject({ code: 'cart_locked', checkoutSessionId })
      return
    }
    expect(refusal).toEqual({ status: 409, body: expect.objectContaining({ code: 'cart_not_active', status: 'locked' }) })
  }

  function goodsGross(totals: Record<string, unknown>): number {
    return Number(totals.grandTotalGrossAmount)
  }

  test('a line update inside its transaction makes cart.lock wait; the lock then judges the updated totals and refuses approval', async () => {
    const scope = races().newTenant()
    const product = await races().seedPricedProduct(scope)
    // 3 x 12.00 gross = 36.00: above the 10.00 approval threshold, covered by the 100.00 approval.
    const cart = await races().seedBasketCart(scope, [{ product, quantity: 3 }], {
      approval: { approvalRequiredAbove: 10, approvedAmountGross: 100 },
    })
    const checkoutSessionId = randomUUID()

    const lockPausedAfterReprice = races().checkpoints.arm('after:cart.reprice')
    const lock = track(lockCart(scope, cart, checkoutSessionId))
    await reachedBy(lockPausedAfterReprice, lock)

    const updatePausedInTransaction = races().checkpoints.arm('promotions.evaluate')
    // 20 x 10.80 (bulk tier) = 216.00 gross: no longer covered by the 100.00 approval.
    const update = track(updateLine(scope, cart, cart.lineIds[0], 20))
    await reachedBy(updatePausedInTransaction, update)

    lockPausedAfterReprice.release()
    await races().waitForLockWaiters('any', cart.cartId, 1, lock)
    expect(lock.isSettled()).toBe(false)
    expect((await races().readCart(cart.cartId)).status).toBe('active')

    updatePausedInTransaction.release()
    expect(expectFulfilled(await update.settled).status).toBe('updated')

    const lockRefusal = expectHttpRejection(await lock.settled)
    expect(lockRefusal.status).toBe(409)
    expect(lockRefusal.body).toMatchObject({ code: 'cart_requires_approval', amountGross: '216' })

    const finalCart = await races().readCart(cart.cartId)
    expect(finalCart.status).toBe('active')
    expect(finalCart.checkoutSessionId ?? null).toBeNull()
    expect(goodsGross(finalCart.totals)).toBe(216)
    const [line] = await races().readActiveLines(cart.cartId)
    expect(Number(line.quantity)).toBe(20)
  })

  test('removing the unavailable line inside its transaction makes cart.lock wait; the lock then locks the cleaned cart', async () => {
    const scope = races().newTenant()
    const product = await races().seedPricedProduct(scope)
    const withdrawnProduct = await races().seedPricedProduct(scope, { isActive: false })
    const cart = await races().seedBasketCart(scope, [
      { product, quantity: 2 },
      { product: withdrawnProduct, quantity: 1, flagged: true },
    ])
    const [keptLineId, unavailableLineId] = cart.lineIds
    const checkoutSessionId = randomUUID()

    // The lock's own forced re-price keeps the withdrawn product's line flagged.
    const lockPausedAfterReprice = races().checkpoints.arm('after:cart.reprice')
    const lock = track(lockCart(scope, cart, checkoutSessionId))
    await reachedBy(lockPausedAfterReprice, lock)

    const removePausedInTransaction = races().checkpoints.arm('promotions.evaluate')
    const remove = track(removeLine(scope, cart, unavailableLineId))
    await reachedBy(removePausedInTransaction, remove)

    lockPausedAfterReprice.release()
    await races().waitForLockWaiters('any', cart.cartId, 1, lock)
    expect(lock.isSettled()).toBe(false)
    expect((await races().readCart(cart.cartId)).status).toBe('active')

    removePausedInTransaction.release()
    expect(expectFulfilled(await remove.settled).removed).toBe(true)
    expect(expectFulfilled(await lock.settled).extended).toBe(false)

    const finalCart = await races().readCart(cart.cartId)
    expect(finalCart.status).toBe('locked')
    expect(finalCart.checkoutSessionId).toBe(checkoutSessionId)
    expect(goodsGross(finalCart.totals)).toBe(24)
    expect((await races().readActiveLines(cart.cartId)).map((line) => line.id)).toEqual([keptLineId])
  })

  test.each(['update', 'remove'] as const)(
    'a %s arriving while cart.lock holds the cart lock waits for it and is refused, leaving the line untouched',
    async (mutation) => {
      const scope = races().newTenant()
      const product = await races().seedPricedProduct(scope)
      const cart = await races().seedBasketCart(scope, [{ product, quantity: 3 }, { product, quantity: 1 }], {
        approval: { approvalRequiredAbove: 10, approvedAmountGross: 100 },
      })
      const targetLineId = cart.lineIds[1]
      const checkoutSessionId = randomUUID()

      // `cart.lock` reaches its approval check inside its own transaction, holding the lock.
      const lockPausedInGate = races().checkpoints.arm('approval.getApproval')
      const lock = track(lockCart(scope, cart, checkoutSessionId))
      await reachedBy(lockPausedInGate, lock)

      const write = track<unknown>(
        mutation === 'update' ? updateLine(scope, cart, targetLineId, 20) : removeLine(scope, cart, targetLineId),
      )
      await races().waitForLockWaiters('advisory', cart.cartId, 1, write)
      expect(write.isSettled()).toBe(false)

      lockPausedInGate.release()
      expect(expectFulfilled(await lock.settled).extended).toBe(false)
      expectRefusedBecauseLocked(await write.settled, checkoutSessionId)

      const finalCart = await races().readCart(cart.cartId)
      expect(finalCart.status).toBe('locked')
      expect(finalCart.checkoutSessionId).toBe(checkoutSessionId)
      // 3 x 12.00 + 1 x 12.00: the totals the lock's approval gate approved.
      expect(goodsGross(finalCart.totals)).toBe(48)
      const lines = await races().readActiveLines(cart.cartId)
      expect(lines.map((line) => [line.id, Number(line.quantity)])).toEqual([
        [cart.lineIds[0], 3],
        [targetLineId, 1],
      ])
    },
  )

  test('a line update that passed its pre-checks before the lock committed is refused by its in-transaction re-check', async () => {
    const scope = races().newTenant()
    const product = await races().seedPricedProduct(scope)
    const cart = await races().seedBasketCart(scope, [{ product, quantity: 2 }])
    const checkoutSessionId = randomUUID()

    // 2 -> 6 crosses into the bulk tier, so the update re-prices before its transaction.
    const updatePausedBeforeTransaction = races().checkpoints.arm('pricing.resolveLinePrice')
    const update = track(updateLine(scope, cart, cart.lineIds[0], 6))
    await reachedBy(updatePausedBeforeTransaction, update)

    expect(expectFulfilled(await track(lockCart(scope, cart, checkoutSessionId)).settled).extended).toBe(false)

    updatePausedBeforeTransaction.release()
    expectRefusedBecauseLocked(await update.settled, checkoutSessionId)

    const finalCart = await races().readCart(cart.cartId)
    expect(finalCart.status).toBe('locked')
    expect(goodsGross(finalCart.totals)).toBe(24)
    const [line] = await races().readActiveLines(cart.cartId)
    expect(Number(line.quantity)).toBe(2)
    expect(line.priceRowId).toBe(product.baseTierRowId)
  })
})
