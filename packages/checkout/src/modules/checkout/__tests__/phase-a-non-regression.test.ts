// Release 5, Step 2.12 — C10's own stated top gate (§3.4/§14a, D-R5-18): "checkout"
// declares NO new `requires` when B.1 (CheckoutSession) ships, so an app that enables
// `checkout` for pay links only — WITHOUT `cart`, `sales`, `customer_groups`,
// `availability`, `promotions`, `shipping_carriers` or `ecommerce` — keeps booting and
// Phase A (pay links) keeps working end to end.
//
// This suite checks the static contract directly (no `requires` field at all, matching
// Phase A's own shipped state) rather than re-running a full app boot — the dynamic half
// of the guarantee (Phase A's pay-link routes complete with no cart/cartService ever
// resolved) is already proven by the FULL pre-existing `api/pay/**` test suite passing
// unchanged alongside this Step's new code: every one of those tests' fake DI container
// throws on an unknown token, so a resolve('cartService') the submit/verify-password/
// status routes never make would have failed them, not passed them.
import { metadata } from '../index'

describe('checkout Phase A non-regression (C10/D-R5-18)', () => {
  it('declares no `requires` on any peer module — cart, sales, customer_groups, availability, promotions, shipping_carriers and ecommerce all stay optional', () => {
    expect((metadata as Record<string, unknown>).requires).toBeUndefined()
  })
})
