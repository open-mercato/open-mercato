import { signAudienceJwt, verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

// Step 3.4 (§7a.4) — the `acceptanceToken` `POST /proposals/:id/preview` returns and
// `POST /proposals/:id/accept` consumes. §7a.4's own text: "The token binds the target
// cart's `updatedAt` AND the proposal cart's `updatedAt`. Either moving invalidates it...
// TTL 15 min." Rather than inventing a bespoke HMAC scheme (every sibling signed-token
// helper in this codebase — `communication_channels/lib/thread-token.ts`,
// `customer_accounts/services/customerSessionService.ts` — either carries no payload at
// all or reinvents the same HMAC-over-JSON shape `signAudienceJwt`/`verifyAudienceJwt`
// already implement), this reuses the shared, audience-scoped JWT helper
// (`@open-mercato/shared/lib/auth/jwt`): the payload IS the two `updatedAt` snapshots plus
// both cart ids, `exp` is `signAudienceJwt`'s own 15-minute `expiresInSec`, and the
// `cart_proposal_acceptance` audience derives its OWN signing key from the base
// `JWT_SECRET` (never shared with the staff/customer session audiences), so a token minted
// here can never be replayed as a staff or customer session token and vice versa.
//
// "Single-use" (TC-CART-PROP-11) falls out of the freshness check alone, without a second
// storage mechanism: a successful `accept` call moves BOTH the target's and the proposal's
// `updatedAt` (the merge writes the target; the proposal's own `status`/`resolvedAt`
// transition writes the proposal), so re-presenting the same token for a second accept call
// fails the freshness comparison in `isAcceptanceTokenFresh` below exactly the same way a
// token issued before some OTHER concurrent change would. No separate single-use ledger is
// needed, or exists.
const ACCEPTANCE_TOKEN_AUDIENCE = 'cart_proposal_acceptance'

/** §7a.4: "TTL 15 min". */
export const CART_PROPOSAL_ACCEPTANCE_TOKEN_TTL_SECONDS = 15 * 60

export type AcceptanceTokenPayload = {
  proposalCartId: string
  targetCartId: string
  proposalUpdatedAt: string
  targetUpdatedAt: string
}

export function signAcceptanceToken(payload: AcceptanceTokenPayload): string {
  return signAudienceJwt(ACCEPTANCE_TOKEN_AUDIENCE, payload, CART_PROPOSAL_ACCEPTANCE_TOKEN_TTL_SECONDS)
}

/** Returns `null` for a missing, malformed, expired, or wrong-audience token — the caller
 * (the `accept` command) treats every one of these identically to an ordinary staleness
 * mismatch (`409 proposal_changed` with a freshly minted preview/token), never a distinct
 * error, so a client cannot distinguish "your token was tampered with" from "something
 * moved" (the same no-oracle discipline this module already applies to its cart-lookup
 * 404s). */
export function verifyAcceptanceToken(token: string): AcceptanceTokenPayload | null {
  const payload = verifyAudienceJwt(ACCEPTANCE_TOKEN_AUDIENCE, token)
  if (!payload) return null
  const { proposalCartId, targetCartId, proposalUpdatedAt, targetUpdatedAt } = payload as Record<string, unknown>
  if (
    typeof proposalCartId !== 'string' ||
    typeof targetCartId !== 'string' ||
    typeof proposalUpdatedAt !== 'string' ||
    typeof targetUpdatedAt !== 'string'
  ) {
    return null
  }
  return { proposalCartId, targetCartId, proposalUpdatedAt, targetUpdatedAt }
}

/** True exactly when `payload` was minted for THIS proposal/target pair at their CURRENT
 * `updatedAt` snapshots — §7a.4: "Either moving invalidates it." */
export function isAcceptanceTokenFresh(
  payload: AcceptanceTokenPayload,
  proposal: { id: string; updatedAt: Date },
  target: { id: string; updatedAt: Date },
): boolean {
  return (
    payload.proposalCartId === proposal.id &&
    payload.targetCartId === target.id &&
    payload.proposalUpdatedAt === proposal.updatedAt.toISOString() &&
    payload.targetUpdatedAt === target.updatedAt.toISOString()
  )
}
