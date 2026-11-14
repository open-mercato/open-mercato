import { createCartApprovalDecidedHandler } from '../lib/approvalDecidedSubscriber'

// Step 3.2 (K5, §9a.5). See `subscribers/approval-approved.ts`'s identical comment.
export const metadata = {
  event: 'customer_groups.approval.expired',
  persistent: true,
  id: 'cart:approval-expired',
}

export default createCartApprovalDecidedHandler(metadata.id)
