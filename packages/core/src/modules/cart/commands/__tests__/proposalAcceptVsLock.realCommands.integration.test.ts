/**
 * Real-command PostgreSQL proof for #9183 scenario 2 (inherited #8268 blocker): a buyer
 * accepting a sales-rep proposal (`cart.proposal.accept`, which delegates to `cart.merge`'s
 * `executeProposalAcceptance` and then dispatches `cart.reprice`) racing a checkout lock
 * (`cart.lock`) on the proposal's TARGET cart. Every command is the real registered handler,
 * dispatched through the real `CommandBus`; see `support/cartCommandRaceHarness.ts` for
 * which peers are real and which are stubbed or absent, and why.
 *
 * The guards under test, all in production code:
 * - `commands/merge.ts#executeProposalAcceptance`: inside its transaction it takes
 *   `pg_advisory_xact_lock` on BOTH `cart:lines:<proposalId>` and `cart:lines:<targetId>`
 *   (sorted), re-reads the target, refuses a locked target with `423 cart_locked`, and only
 *   then flips the proposal with a conditional `nativeUpdate` guarded on `status = 'active'`.
 * - `commands/lock.ts#lockCartCommand`: takes `cart:lines:<targetId>`, re-reads the cart and
 *   its lines, recomputes totals and `requiresApproval` from those lines, and only then runs
 *   its gate and its own conditional `active -> locked` write.
 *
 * Interleavings, pinned with checkpoints and a row lock the test holds itself:
 * 1. accept passed every pre-check, then the lock committed: the in-transaction re-read
 *    refuses the accept, the proposal stays active and unmerged, the target is untouched;
 * 2. accept is inside its transaction (holding both cart locks) when checkout locks: the
 *    lock waits on the target's cart lock until the merge commits, and the cart it locks
 *    carries the merged line, merged exactly once, with totals that include it;
 * 3. the same wait with an approval that covered the pre-merge cart only: the lock judges
 *    the merged lines, not the stored pre-merge totals, and refuses.
 *
 * Runs in the `test:pg-integration` CI job (`OM_PG_INTEGRATION=1`, own disposable
 * Postgres container), or against a throwaway database named by `OM_CART_PG_URL`.
 */
import { randomUUID } from 'node:crypto'
import type { CartLockInput, CartLockResult } from '../lock'
import type { CartProposalAcceptInput, CartProposalAcceptResult } from '../proposal'
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

describeWithPostgres('cart.proposal.accept vs a checkout cart.lock through the real commands (#9183 scenario 2)', () => {
  jest.setTimeout(120_000)
  let harness: CartRaceHarness | undefined

  function races(): CartRaceHarness {
    if (!harness) throw new Error('[internal] cart race harness is not started')
    return harness
  }

  beforeAll(async () => {
    harness = await startCartRaceHarness('cart-proposal-accept-vs-lock')
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

  function acceptProposal(
    scope: TenantScope,
    target: SeededCart,
    proposal: { proposalCartId: string; proposalLineId: string; acceptanceToken: string },
  ): Promise<CartProposalAcceptResult> {
    return races().run<CartProposalAcceptInput, CartProposalAcceptResult>(
      'cart.proposal.accept',
      {
        proposalCartId: proposal.proposalCartId,
        targetCartId: target.cartId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        acceptanceToken: proposal.acceptanceToken,
        lines: [{ proposalLineId: proposal.proposalLineId, accepted: true }],
        routeContext: target.routeContext,
      },
      scope,
    )
  }

  function goodsGross(totals: Record<string, unknown>): number {
    return Number(totals.grandTotalGrossAmount)
  }

  async function seedTargetWithProposal(scope: TenantScope) {
    const product = await races().seedPricedProduct(scope)
    // Target: 2 x 12.00 gross. Proposal: one extra line, 1 x 12.00 gross.
    const target = await races().seedBasketCart(scope, [{ product, quantity: 2 }])
    const proposal = await races().seedProposal(scope, target, product, 1)
    return { product, target, proposal }
  }

  test('an accept that passed its pre-checks before the lock committed is refused in its transaction; nothing is merged', async () => {
    const scope = races().newTenant()
    const { target, proposal } = await seedTargetWithProposal(scope)
    const checkoutSessionId = randomUUID()

    // `executeProposalAcceptance` checks the target for a lock BEFORE this visibility read;
    // pausing here leaves only the in-transaction re-read between the accept and the merge.
    const acceptPausedBeforeTransaction = races().checkpoints.arm('catalog.loadScopedProducts')
    const accept = track(acceptProposal(scope, target, proposal))
    await reachedBy(acceptPausedBeforeTransaction, accept)

    expect(expectFulfilled(await track(lockCart(scope, target, checkoutSessionId)).settled).extended).toBe(false)

    acceptPausedBeforeTransaction.release()
    const refusal = expectHttpRejection(await accept.settled)
    expect(refusal.status).toBe(423)
    expect(refusal.body).toMatchObject({ code: 'cart_locked', checkoutSessionId })

    const storedProposal = await races().readCart(proposal.proposalCartId)
    expect(storedProposal.status).toBe('active')
    expect(storedProposal.mergedIntoCartId ?? null).toBeNull()
    expect(await races().countMergeLogs(target.cartId)).toBe(0)
    const lockedTarget = await races().readCart(target.cartId)
    expect(lockedTarget.status).toBe('locked')
    expect(goodsGross(lockedTarget.totals)).toBe(24)
    expect((await races().readActiveLines(target.cartId)).map((line) => line.id)).toEqual(target.lineIds)
  })

  test('an accept inside its transaction makes the checkout lock wait on the target cart lock; the cart it locks carries the merge', async () => {
    const scope = races().newTenant()
    const { target, proposal } = await seedTargetWithProposal(scope)
    const checkoutSessionId = randomUUID()

    // Checkout's lock finishes its own forced re-price first, then waits to take the cart.
    const lockPausedAfterReprice = races().checkpoints.arm('after:cart.reprice')
    const lock = track(lockCart(scope, target, checkoutSessionId))
    await reachedBy(lockPausedAfterReprice, lock)

    // That re-price moved the target's `updatedAt`; the buyer's preview hands out a fresh token.
    const acceptanceToken = await races().mintAcceptanceToken(proposal.proposalCartId, target.cartId)
    // The accept's guarded `nativeUpdate` on the proposal row is its first write after taking
    // both cart locks and re-reading the target; a row lock held here parks it right there.
    const proposalRowLock = await races().holdRowLock('carts', proposal.proposalCartId)
    const accept = track(acceptProposal(scope, target, { ...proposal, acceptanceToken }))
    await races().waitForLockWaiters('row', proposal.proposalCartId, 1, accept)
    expect(accept.isSettled()).toBe(false)

    // Blocked on the cart's line-mutation lock, the one the accept holds for the target. (The
    // parked accept is itself a row waiter whose statement names the target, through
    // `merged_into_cart_id`, so only an advisory wait identifies the lock here.)
    lockPausedAfterReprice.release()
    await races().waitForLockWaiters('advisory', target.cartId, 1, lock)
    expect(lock.isSettled()).toBe(false)
    expect((await races().readCart(target.cartId)).status).toBe('active')

    await proposalRowLock.release()
    expect(expectFulfilled(await lock.settled).extended).toBe(false)
    // Not asserted: whether the accept's own post-merge `cart.reprice` runs before or after
    // the lock commits is timing-dependent (after it, that re-price is refused 423).
    await accept.settled

    const lockedTarget = await races().readCart(target.cartId)
    expect(lockedTarget.status).toBe('locked')
    expect(lockedTarget.checkoutSessionId).toBe(checkoutSessionId)
    expect(goodsGross(lockedTarget.totals)).toBe(36)
    const lockedLines = await races().readActiveLines(target.cartId)
    expect(lockedLines).toHaveLength(2)
    expect(lockedLines.map((line) => line.addedByActorType).sort()).toEqual(['buyer', 'merge'])
    expect((await races().readCart(proposal.proposalCartId)).status).toBe('merged')
    expect(await races().countMergeLogs(target.cartId)).toBe(1)
  })

  // Regression for the defect reported on #9183: `executeProposalAcceptance` commits the
  // merged lines and leaves `Cart.totals`/`requiresApproval` to the `cart.reprice` it
  // dispatches after commit. A checkout lock waiting on the target's cart lock acquires it
  // the moment the merge commits; its gate used to judge the stored pre-merge totals. Here
  // 2 x 12.00 = 24.00 is covered by a 30.00 approval and the merged cart is 36.00, so the
  // lock must refuse `409 cart_requires_approval`, exactly as accept-then-lock in sequence
  // does. Pinning the accept's post-merge re-price keeps the stored totals stale while the
  // lock decides (unpinned, the lock won all 10 rounds of a local run).
  test('a checkout lock that waited out a proposal merge refuses the merged cart above its approval', async () => {
    const scope = races().newTenant()
    const product = await races().seedPricedProduct(scope)
    const target = await races().seedBasketCart(scope, [{ product, quantity: 2 }], {
      approval: { approvalRequiredAbove: 10, approvedAmountGross: 30 },
    })
    const proposal = await races().seedProposal(scope, target, product, 1)
    const checkoutSessionId = randomUUID()

    const lockPausedAfterReprice = races().checkpoints.arm('after:cart.reprice')
    const lock = track(lockCart(scope, target, checkoutSessionId))
    await reachedBy(lockPausedAfterReprice, lock)
    const acceptanceToken = await races().mintAcceptanceToken(proposal.proposalCartId, target.cartId)
    const proposalRowLock = await races().holdRowLock('carts', proposal.proposalCartId)
    const accept = track(acceptProposal(scope, target, { ...proposal, acceptanceToken }))
    await races().waitForLockWaiters('row', proposal.proposalCartId, 1, accept)
    lockPausedAfterReprice.release()
    await races().waitForLockWaiters('advisory', target.cartId, 1, lock)

    // The accept's post-merge `cart.reprice` is the next dispatch of that command.
    const acceptRepricePaused = races().checkpoints.arm('before:cart.reprice')
    await proposalRowLock.release()
    await reachedBy(acceptRepricePaused, accept)
    const lockOutcome = await lock.settled
    acceptRepricePaused.release()
    await accept.settled

    const refusal = expectHttpRejection(lockOutcome)
    expect(refusal).toEqual({
      status: 409,
      body: expect.objectContaining({ code: 'cart_requires_approval', amountGross: '36' }),
    })
    expect((await races().readCart(target.cartId)).status).toBe('active')
  })
})
