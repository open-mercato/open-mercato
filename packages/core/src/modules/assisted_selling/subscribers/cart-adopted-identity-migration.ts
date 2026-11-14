import { handleCartAdoptedForAssistedSellingIdentity } from '../lib/cartAdoptedIdentityMigration'

// #8268 review Major 5 (follow-up from issue #9392) — see `lib/cartAdoptedIdentityMigration.ts`'s
// own header comment. Persistent: a transient failure must retry via redelivery rather than
// leave a thread's buyer identity unresolved, same convention as `cart-merged-reauthor.ts`.
export const metadata = {
  event: 'cart.cart.adopted',
  persistent: true,
  id: 'assisted_selling:cart-adopted-identity-migration',
}

export default handleCartAdoptedForAssistedSellingIdentity
