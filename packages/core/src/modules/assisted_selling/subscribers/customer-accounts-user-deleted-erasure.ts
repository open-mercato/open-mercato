import { handleCustomerAccountsUserDeletedErasure } from '../lib/erasureSubscribers'

// Step 4.5 (§5.10, S7). Persistent — same reasoning as `cart-purged-erasure.ts`.
export const metadata = {
  event: 'customer_accounts.user.deleted',
  persistent: true,
  id: 'assisted_selling:customer-user-deleted-erasure',
}

export default handleCustomerAccountsUserDeletedErasure
