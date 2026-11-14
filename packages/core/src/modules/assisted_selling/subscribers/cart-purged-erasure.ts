import { handleCartPurgedErasure } from '../lib/erasureSubscribers'

// Step 4.5 (§5.10, S7). Persistent: erasure is a real write (hard-deletes + a soft-delete)
// and must survive a worker restart — same convention this module's other persistent
// subscribers (`cart-merged-reauthor.ts`, `cart-proposal-*.ts`) already use.
export const metadata = {
  event: 'cart.cart.purged',
  persistent: true,
  id: 'assisted_selling:cart-purged-erasure',
}

export default handleCartPurgedErasure
