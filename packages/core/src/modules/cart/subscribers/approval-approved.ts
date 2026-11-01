import { createCartApprovalDecidedHandler } from '../lib/approvalDecidedSubscriber'

// Step 3.2 (K5, §9a.5). Clears `Cart.awaitingApprovalSince` — see `lib/
// approvalDecidedSubscriber.ts` for the shared parsing/write logic and the explicit
// "approval_id is unchanged" rule.
export const metadata = {
  event: 'customer_groups.approval.approved',
  persistent: true,
  id: 'cart:approval-approved',
}

export default createCartApprovalDecidedHandler(metadata.id)
