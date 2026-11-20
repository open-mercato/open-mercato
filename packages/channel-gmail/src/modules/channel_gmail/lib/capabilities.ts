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
 * `fileSharing: true`: `convertOutbound` stitches the attachment bytes the hub
 * reads from the attachments module into the RFC2822 body, and messages above
 * the simple-send size go through Gmail's media-upload endpoint.
 */
export const gmailCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  fileSharing: true,
  // Gmail supports moving a message to Trash via the API.
  deleteMessage: true,
}
