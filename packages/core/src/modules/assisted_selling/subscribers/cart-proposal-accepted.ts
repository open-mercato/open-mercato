import { createCartProposalTerminalHandler } from '../lib/terminalStateSubscriber'

// Step 4.4-fix (§6.6). Acceptance is always buyer/checkout-initiated — never this module's
// own author-side commands — so this handler always owns the decrement, unconditionally.
export const metadata = {
  event: 'cart.proposal.accepted',
  persistent: true,
  id: 'assisted_selling:terminal-state-accepted',
}

export default createCartProposalTerminalHandler({
  targetStatus: 'accepted',
  emitEventId: 'assisted_selling.proposal.accepted',
  subscriberId: metadata.id,
})
