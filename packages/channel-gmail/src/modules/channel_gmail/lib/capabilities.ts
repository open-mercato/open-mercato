import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  EMAIL_MAX_ATTACHMENT_BYTES,
  baseEmailCapabilities,
} from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'

/**
 * Gmail capabilities. Polling-based for now (`realtimePush: false`) — Pub/Sub
 * push is documented as a v2 follow-up in the email integration spec.
 *
 * Threading is supported natively via Gmail `threadId` plus RFC2822
 * In-Reply-To/References. Attachment ceiling matches the shared email baseline.
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's
 * `convertOutbound` does not yet stitch attachment URLs into the base64-encoded
 * RFC2822 body it sends via `users.messages.send`. Re-enable when the URL-fetch
 * + MIME stitching flow lands.
 */
export const GMAIL_MAX_ATTACHMENT_BYTES = EMAIL_MAX_ATTACHMENT_BYTES

export const gmailCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  // Gmail supports moving a message to Trash via the API.
  deleteMessage: true,
}
