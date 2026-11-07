import { handleCartMergedForAssistedSellingReauthor } from '../lib/reauthorOnMerge'

// Step 4.4-fix (§8.1/D-R5-14) — see `lib/reauthorOnMerge.ts`'s own header comment. The real,
// in-module version of Step 3.3's provisional `cart`-side mechanism (`cart/lib/
// proposalRetarget.ts` + `cart/subscribers/cart-merged-proposal-retarget.ts`, both removed by
// this Step). Persistent: a login merge's re-author/supersede pass does real work (another
// command dispatch) and must survive a worker restart — same convention the removed
// cart-side subscriber, and this module's own terminal-state subscribers, already use.
export const metadata = {
  event: 'cart.cart.merged',
  persistent: true,
  id: 'assisted_selling:reauthor-on-merge',
}

export default handleCartMergedForAssistedSellingReauthor
