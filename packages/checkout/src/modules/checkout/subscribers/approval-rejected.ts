import { createCheckoutApprovalResumeHandler } from '../lib/approvalResumeSubscriber'

// Release 5, Step 5.2 (C11, §8.2 step 3). See `lib/approvalResumeSubscriber.ts` for the
// shared resume logic — `rejected` moves a live `awaiting_approval` session to `failed`
// (`failure_code: 'approval_rejected'`) and emits `checkout.session.approval_rejected`.
export const metadata = {
  event: 'customer_groups.approval.rejected',
  persistent: true,
  id: 'checkout:approval-rejected',
}

export default createCheckoutApprovalResumeHandler(metadata.id, 'rejected')
