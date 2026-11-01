import { handleAuthUserDeletedErasure } from '../lib/erasureSubscribers'

// Step 4.5 (§5.10, S7). Persistent — same reasoning as `cart-purged-erasure.ts`.
export const metadata = {
  event: 'auth.user.deleted',
  persistent: true,
  id: 'assisted_selling:auth-user-deleted-erasure',
}

export default handleAuthUserDeletedErasure
