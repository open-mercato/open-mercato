import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { Cart } from '../data/entities'

// Step 7.5 — §9's own text: "A locked cart that a client tries to mutate returns `423
// Locked` with the checkout session id, not a generic error — the client needs to know to
// send the buyer back to checkout." A locked cart is deliberately NOT folded into the
// §6a.3 no-write-side-enumeration-oracle 404 collapse every OTHER non-active status gets
// (`loadMutableCart` in `commands/lines.ts`, the inline status check in `commands/merge.ts`):
// locked-ness is not a secret worth protecting the way "does this cart exist at all" is —
// the buyer presenting this cart's own token already knows the cart is theirs and mid
// checkout, so telling them it is locked discloses nothing they could not already infer
// from their own checkout flow stalling.
//
// Shared by every command file that gates a mutation on cart status
// (`commands/lines.ts`, `commands/merge.ts`, `commands/promotions.ts`, `commands/lock.ts`
// itself for `cart.lock`'s own re-lock/relock guard) so the 423 shape — error code,
// `checkoutSessionId` in the body (§15a's error-code catalogue: `cart_locked` / 423) —
// never drifts between call sites. This module's own established style favors a small
// shared `lib/` helper over duplicating this check inline in three-plus places
// (`lib/visibility.ts`, `lib/rateLimit.ts`), so it lives here rather than as three
// near-identical inline `if` statements.
export function assertCartNotLocked(cart: Pick<Cart, 'status' | 'checkoutSessionId'>): void {
  if (cart.status !== 'locked') return
  throw new CrudHttpError(423, {
    error: '[internal] cart_locked',
    code: 'cart_locked',
    checkoutSessionId: cart.checkoutSessionId ?? null,
  })
}
