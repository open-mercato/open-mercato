/**
 * Real-command PostgreSQL proof for the M8 review finding (inherited #8268 blocker): the
 * `acceptanceToken` `cart.proposal.accept` (`commands/proposal.ts`) verifies is checked
 * against UNLOCKED `target`/`proposal` snapshots. Before this fix, neither cart's
 * `updatedAt` reached `cart.merge`'s own `executeProposalAcceptance`
 * (`commands/merge.ts`) — so a write landing on the still-active target in the gap between
 * that verification and the merge's own `pg_advisory_xact_lock` acquisition was silently
 * merged over, violating §7a.4's "either preview version moves -> 409 proposal_changed,
 * nothing merged" rule.
 *
 * The fix: `cart.proposal.accept` now carries the exact `updatedAt` snapshots its freshness
 * check just verified (`expectedTargetUpdatedAt`/`expectedProposalUpdatedAt`) into
 * `cart.merge`'s own input, and `executeProposalAcceptance` re-checks both, UNDER THE SAME
 * per-cart advisory locks it already takes, before transitioning the proposal or touching
 * the target's lines.
 *
 * This suite pins the real gap deterministically with the `before:cart.merge` checkpoint —
 * which fires the instant `cart.proposal.accept` dispatches `cart.merge`, i.e. strictly
 * AFTER the token's freshness check already passed and STRICTLY BEFORE `cart.merge` takes
 * any lock — and performs a real, production-code edit to the target cart
 * (`cart.lines.add`) while paused there. Every command is the real registered handler,
 * dispatched through the real `CommandBus`; see `support/cartCommandRaceHarness.ts` for
 * which peers are real and which are stubbed or absent, and why.
 *
 * Scope note: this suite only exercises the TARGET side of the race. There is no
 * production write path that moves a proposal cart's own `updatedAt` while leaving it
 * `status: 'active'` (only `cart.proposal.accept`/`.reject` ever touch a proposal, and both
 * transition its status) — a concurrent proposal-side change is always ALSO a status
 * change, which the pre-existing (and separately tested) `cart_not_active` guard already
 * catches before the lock. The PROPOSAL-side half of this fix (a version mismatch under the
 * lock with status still `active`) is exercised by the two unit tests in `merge.test.ts`
 * ("refuses with 409 proposal_changed... when the TARGET/PROPOSAL moved"), which can force
 * that otherwise-unreachable combination directly.
 *
 * Runs in the `test:pg-integration` CI job (`OM_PG_INTEGRATION=1`, own disposable Postgres
 * container), or against a throwaway database named by `OM_CART_PG_URL`.
 */
import type { CartLinesAddInput, CartLinesAddOutcome } from '../lines'
import type { CartProposalAcceptInput, CartProposalAcceptResult } from '../proposal'
import {
  cartRacesRunAgainstPostgres,
  expectHttpRejection,
  reachedBy,
  startCartRaceHarness,
  track,
  type CartRaceHarness,
  type SeededCart,
  type TenantScope,
} from './support/cartCommandRaceHarness'

const describeWithPostgres = cartRacesRunAgainstPostgres ? describe : describe.skip

describeWithPostgres('cart.proposal.accept vs a stale target/proposal snapshot (M8 review finding)', () => {
  jest.setTimeout(120_000)
  let harness: CartRaceHarness | undefined

  function races(): CartRaceHarness {
    if (!harness) throw new Error('[internal] cart race harness is not started')
    return harness
  }

  beforeAll(async () => {
    harness = await startCartRaceHarness('cart-proposal-accept-vs-stale-target')
  }, 120_000)

  afterEach(async () => {
    expect((await harness?.releaseAll()) ?? []).toEqual([])
  })

  afterAll(async () => {
    await harness?.close()
  })

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

  async function addLineToTarget(scope: TenantScope, target: SeededCart, product: { productId: string }) {
    return races().run<CartLinesAddInput, CartLinesAddOutcome>(
      'cart.lines.add',
      {
        cartId: target.cartId,
        productId: product.productId,
        quantity: 1,
        routeContext: target.routeContext,
      },
      scope,
    )
  }

  test('a target edit landing between token verification and lock acquisition refuses the accept with 409 proposal_changed; nothing merges', async () => {
    const scope = races().newTenant()
    const product = await races().seedPricedProduct(scope)
    // Target: 2 x 12.00 gross. Proposal: one extra line, 1 x 12.00 gross.
    const target = await races().seedBasketCart(scope, [{ product, quantity: 2 }])
    const proposal = await races().seedProposal(scope, target, product, 1)

    // The accept's own `acceptanceToken` was minted (by `seedProposal`) against the target's
    // and proposal's CURRENT `updatedAt` — exactly what a real `preview` call would hand the
    // buyer. `cart.proposal.accept` verifies it fresh, then dispatches `cart.merge`; this
    // checkpoint fires at that exact dispatch boundary, strictly after the (passing)
    // verification and strictly before `executeProposalAcceptance` takes any lock.
    const acceptPausedBeforeMerge = races().checkpoints.arm('before:cart.merge')
    const accept = track(acceptProposal(scope, target, proposal))
    await reachedBy(acceptPausedBeforeMerge, accept)

    // A deterministic, real production-code edit to the STILL-ACTIVE target, landing in the
    // exact gap the fix closes.
    const addOutcome = await addLineToTarget(scope, target, product)
    expect(addOutcome.status).toBe('added')

    acceptPausedBeforeMerge.release()
    const refusal = expectHttpRejection(await accept.settled)
    expect(refusal.status).toBe(409)
    expect(refusal.body).toMatchObject({ code: 'proposal_changed' })
    expect(typeof refusal.body.acceptanceToken).toBe('string')
    expect(refusal.body.acceptancePreview).toMatchObject({ proposalCartId: proposal.proposalCartId, targetCartId: target.cartId })

    // Nothing merged: the proposal is still active, unmerged; no merge log; the target
    // carries only its original line plus the one just added — never the proposal's line.
    const storedProposal = await races().readCart(proposal.proposalCartId)
    expect(storedProposal.status).toBe('active')
    expect(storedProposal.mergedIntoCartId ?? null).toBeNull()
    expect(await races().countMergeLogs(target.cartId)).toBe(0)
    const targetLines = await races().readActiveLines(target.cartId)
    expect(targetLines).toHaveLength(2)
    expect(targetLines.every((line) => line.addedByActorType !== 'merge')).toBe(true)
  })
})
