import { createCheckoutApprovalResumeHandler } from '../lib/approvalResumeSubscriber'

// Release 5, Step 5.2 (C11, §8.2 step 3). See `lib/approvalResumeSubscriber.ts` for the
// shared resume logic — `withdrawn` moves a live `awaiting_approval` session back to
// `open` (the buyer may request again or reduce the cart) and emits
// `checkout.session.approval_rejected` with `outcome: 'withdrawn'` in the payload.
export const metadata = {
  event: 'customer_groups.approval.withdrawn',
  persistent: true,
  id: 'checkout:approval-withdrawn',
}

export default createCheckoutApprovalResumeHandler(metadata.id, 'withdrawn')
