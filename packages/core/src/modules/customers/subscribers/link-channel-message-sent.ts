/**
 * Persistent subscriber for `communication_channels.message.sent`.
 *
 * When an outbound email is delivered, resolves People by address (or by the
 * `crmPersonId` hint written by the compose route) and creates CustomerInteraction
 * rows. Reads `crmVisibility` from `channelMetadata` to set the per-row
 * visibility ('private' | 'shared').
 *
 * Logic lives in `../lib/link-channel-message-handler.ts`; both this file
 * and `link-channel-message-received.ts` delegate there so the two subscriber
 * registrations can share a single implementation.
 */
import linkChannelMessageHandler from '../lib/link-channel-message-handler'

export const metadata = {
  event: 'communication_channels.message.sent',
  persistent: true,
  id: 'customers:link-channel-message-sent',
}

export default linkChannelMessageHandler
