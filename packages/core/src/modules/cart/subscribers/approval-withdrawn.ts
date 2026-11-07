import { createCartApprovalDecidedHandler } from '../lib/approvalDecidedSubscriber'

// Step 3.2 (K5, §9a.5). See `subscribers/approval-approved.ts`'s identical comment. Also
// catches a cart's OWN cart-initiated withdrawal (merge/expire/purge, `lib/
// approvalLifecycle.ts`) on redelivery — those already clear `awaitingApprovalSince`
// synchronously in the same write as their own transition, so this handler's own update
// matches zero rows the second time and is a no-op, never a double-write hazard.
export const metadata = {
  event: 'customer_groups.approval.withdrawn',
  persistent: true,
  id: 'cart:approval-withdrawn',
}

export default createCartApprovalDecidedHandler(metadata.id)
