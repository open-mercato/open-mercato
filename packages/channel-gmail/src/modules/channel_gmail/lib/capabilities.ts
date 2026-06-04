import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { baseEmailCapabilities } from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'

/**
 * Gmail capabilities. `realtimePush: false` is deliberate: Gmail Pub/Sub push IS
 * implemented (the adapter registers/renews `users.watch` and applies history
 * notifications), but the hub keeps polling as a belt-and-suspenders fallback, so
 * the capability flag stays false to preserve the polling cadence.
 *
 * Threading is supported natively via Gmail `threadId` plus RFC2822
 * In-Reply-To/References. Attachment ceiling matches the shared email baseline.
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's
 * `convertOutbound` does not yet stitch attachment URLs into the base64-encoded
 * RFC2822 body it sends via `users.messages.send`. Re-enable when the URL-fetch
 * + MIME stitching flow lands.
 */
export const gmailCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  // Gmail supports moving a message to Trash via the API.
  deleteMessage: true,
}
