/**
 * link-channel-message.ts
 *
 * This file exists to satisfy the test suite's import of `../link-channel-message`
 * and to export the canonical subscriber metadata for documentation purposes.
 *
 * The AUTO-DISCOVERY scanner requires a single `event` string per subscriber file.
 * Because we handle TWO events, the actual subscriber registrations are in:
 *   - link-channel-message-received.ts  (communication_channels.message.received)
 *   - link-channel-message-sent.ts      (communication_channels.message.sent)
 *
 * Both delegate their logic to `_internal/link-channel-message-handler.ts`.
 */
export { default } from './_internal/link-channel-message-handler'

/**
 * Logical metadata — used by tests and documentation. Not registered with
 * the auto-discovery scanner (the two sub-files provide their own metadata).
 */
export const metadata = {
  event: [
    'communication_channels.message.received',
    'communication_channels.message.sent',
  ] as const,
  persistent: true,
  id: 'customers:link-channel-message',
}
