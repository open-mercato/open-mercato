import { handleCartConvertedForAttribution } from '../lib/attribution'

// Step 5.4 (§6.7/§11 Phase 4, S18/D-R5-16/D-R5-26). "A subscriber on `cart.cart.converted`
// writes one `AssistedSellingAttribution` per cart line." Persistent — the same delivery
// guarantee `subscribers/cart-proposal-accepted.ts` and friends already rely on for a
// cross-module signal this module must never miss.
export const metadata = {
  event: 'cart.cart.converted',
  persistent: true,
  id: 'assisted_selling:cart-converted-attribution',
}

export default handleCartConvertedForAttribution
