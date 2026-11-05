/**
 * Persistent subscriber for `communication_channels.message.received`.
 *
 * When an inbound email arrives, resolves People by address from the linked
 * MessageChannelLink and creates CustomerInteraction rows (one per match).
 * Falls back to threading-inheritance (In-Reply-To chain) when no direct
 * address match is found.
 *
 * Logic lives in `../lib/link-channel-message-handler.ts`; both this file
 * and `link-channel-message-sent.ts` delegate there so the two subscriber
 * registrations can share a single implementation.
 */
import linkChannelMessageHandler from '../lib/link-channel-message-handler'

export const metadata = {
  event: 'communication_channels.message.received',
  persistent: true,
  id: 'customers:link-channel-message-received',
}

export default linkChannelMessageHandler
