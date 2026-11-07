import { createApprovalDecidedHandler } from '../lib/approvalDecidedSubscriberHandler'

// Release 5 Phase 4 (G15, D-R5-6, §10.2, Step 2.7). E-mails the requester, when a
// `customer_user`, that their request expired without a decision — see `lib/
// approvalDecidedSubscriberHandler.ts` for the shared parsing/dispatch logic.
export const metadata = {
  event: 'customer_groups.approval.expired',
  persistent: true,
  id: 'customer_groups:approval-expired-notification',
}

export default createApprovalDecidedHandler('expired', metadata.id)
