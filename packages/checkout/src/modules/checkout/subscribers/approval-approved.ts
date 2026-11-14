import { createCheckoutApprovalResumeHandler } from '../lib/approvalResumeSubscriber'

// Release 5, Step 5.2 (C11, §8.2 step 3). See `lib/approvalResumeSubscriber.ts` for the
// shared resume logic — `approved` moves a live `awaiting_approval` session back to
// `open` (quoted_totals cleared) and emits `checkout.session.approval_approved`.
export const metadata = {
  event: 'customer_groups.approval.approved',
  persistent: true,
  id: 'checkout:approval-approved',
}

export default createCheckoutApprovalResumeHandler(metadata.id, 'approved')
