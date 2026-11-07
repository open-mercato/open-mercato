// Step 3.4 (§7a.4) — `signAcceptanceToken`/`verifyAcceptanceToken`/`isAcceptanceTokenFresh`.
// Sets `JWT_SECRET` before import (mirrors `customer_accounts/__tests__/customerAuth.test.ts`'s
// own convention for exercising `@open-mercato/shared/lib/auth/jwt` directly, unmocked).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-cart-proposal-acceptance-tests'

import { isAcceptanceTokenFresh, signAcceptanceToken, verifyAcceptanceToken } from '../acceptanceToken'

const PROPOSAL = { id: 'proposal-1', updatedAt: new Date('2026-03-01T00:00:00.000Z') }
const TARGET = { id: 'cart-target-1', updatedAt: new Date('2026-03-01T00:05:00.000Z') }

function signForFixtures() {
  return signAcceptanceToken({
    proposalCartId: PROPOSAL.id,
    targetCartId: TARGET.id,
    proposalUpdatedAt: PROPOSAL.updatedAt.toISOString(),
    targetUpdatedAt: TARGET.updatedAt.toISOString(),
  })
}

describe('signAcceptanceToken / verifyAcceptanceToken', () => {
  it('round-trips a signed token', () => {
    const token = signForFixtures()
    const payload = verifyAcceptanceToken(token)
    expect(payload).toEqual({
      proposalCartId: PROPOSAL.id,
      targetCartId: TARGET.id,
      proposalUpdatedAt: PROPOSAL.updatedAt.toISOString(),
      targetUpdatedAt: TARGET.updatedAt.toISOString(),
    })
  })

  it('rejects a malformed token', () => {
    expect(verifyAcceptanceToken('not-a-real-token')).toBeNull()
  })

  it('rejects a token signed under a different audience (e.g. a customer session JWT)', () => {
    // `signAudienceJwt`'s own audience-derived key means a token minted for ANY other
    // audience fails signature verification here outright — never reaches payload shape
    // checking at all.
    const { signAudienceJwt } = require('@open-mercato/shared/lib/auth/jwt')
    const foreignToken = signAudienceJwt('customer', {
      proposalCartId: PROPOSAL.id,
      targetCartId: TARGET.id,
      proposalUpdatedAt: PROPOSAL.updatedAt.toISOString(),
      targetUpdatedAt: TARGET.updatedAt.toISOString(),
    })
    expect(verifyAcceptanceToken(foreignToken)).toBeNull()
  })

  it('rejects a token missing a required payload field', () => {
    const { signAudienceJwt } = require('@open-mercato/shared/lib/auth/jwt')
    const incomplete = signAudienceJwt('cart_proposal_acceptance', { proposalCartId: PROPOSAL.id })
    expect(verifyAcceptanceToken(incomplete)).toBeNull()
  })
})

describe('isAcceptanceTokenFresh', () => {
  it('is fresh for the exact proposal/target pair at their current updatedAt', () => {
    const payload = verifyAcceptanceToken(signForFixtures())!
    expect(isAcceptanceTokenFresh(payload, PROPOSAL, TARGET)).toBe(true)
  })

  it('is stale when the TARGET moved', () => {
    const payload = verifyAcceptanceToken(signForFixtures())!
    const movedTarget = { ...TARGET, updatedAt: new Date(TARGET.updatedAt.getTime() + 1000) }
    expect(isAcceptanceTokenFresh(payload, PROPOSAL, movedTarget)).toBe(false)
  })

  it('is stale when the PROPOSAL moved', () => {
    const payload = verifyAcceptanceToken(signForFixtures())!
    const movedProposal = { ...PROPOSAL, updatedAt: new Date(PROPOSAL.updatedAt.getTime() + 1000) }
    expect(isAcceptanceTokenFresh(payload, movedProposal, TARGET)).toBe(false)
  })

  it('is stale when the ids do not match (a token minted for a different proposal/target pair)', () => {
    const payload = verifyAcceptanceToken(signForFixtures())!
    expect(isAcceptanceTokenFresh(payload, { id: 'other-proposal', updatedAt: PROPOSAL.updatedAt }, TARGET)).toBe(false)
  })

  // §7a.4: "the token... is single-use" — a successful accept moves BOTH carts'
  // `updatedAt`, so re-presenting the same (still-unexpired) token for a second accept call
  // fails freshness exactly like any other staleness mismatch, with no separate ledger.
  it('a token used once (both carts\' updatedAt advanced by the accept it drove) is stale on replay', () => {
    const payload = verifyAcceptanceToken(signForFixtures())!
    const afterAccept = {
      proposal: { ...PROPOSAL, updatedAt: new Date(PROPOSAL.updatedAt.getTime() + 5000) },
      target: { ...TARGET, updatedAt: new Date(TARGET.updatedAt.getTime() + 5000) },
    }
    expect(isAcceptanceTokenFresh(payload, afterAccept.proposal, afterAccept.target)).toBe(false)
  })
})
