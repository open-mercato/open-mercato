import { createCartProposalTerminalHandler } from '../lib/terminalStateSubscriber'

// Step 4.4-fix (§6.6). Expiry is always sweeper/system-initiated (`cart/lib/sweepers.ts`'s
// `expire-carts` job) — never this module's own author-side commands — so this handler
// always owns the decrement, unconditionally.
export const metadata = {
  event: 'cart.proposal.expired',
  persistent: true,
  id: 'assisted_selling:terminal-state-expired',
}

export default createCartProposalTerminalHandler({
  targetStatus: 'expired',
  emitEventId: 'assisted_selling.proposal.expired',
  subscriberId: metadata.id,
})
