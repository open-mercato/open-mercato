import { createCartProposalTerminalHandler } from '../lib/terminalStateSubscriber'

// Step 4.4-fix (§6.6). `skipWhenRejectedByAuthor: true` — withdraw and every supersede path
// (`.reauthor`, the merge-retarget subscriber) already decrement locally and synchronously;
// see `lib/terminalStateSubscriber.ts`'s own header comment for why this handler must not
// also act on a `rejectedBy: 'author'` payload.
export const metadata = {
  event: 'cart.proposal.rejected',
  persistent: true,
  id: 'assisted_selling:terminal-state-rejected',
}

export default createCartProposalTerminalHandler({
  targetStatus: 'rejected',
  emitEventId: 'assisted_selling.proposal.rejected',
  subscriberId: metadata.id,
  skipWhenRejectedByAuthor: true,
})
