import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  EMAIL_MAX_ATTACHMENT_BYTES,
  baseEmailCapabilities,
} from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'

/**
 * Microsoft 365 / Outlook capabilities. Polling-driven (delta query) for now;
 * Microsoft Graph subscriptions (push) are deferred to v2.
 *
 * Outlook honors RFC2822 In-Reply-To / References natively and adds its own
 * `conversationId` field on each `Message` resource — the adapter prefers it for
 * grouping (parallels Gmail's `threadId`). Attachment ceiling matches the shared
 * email baseline.
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's `convertOutbound`
 * does not yet populate the `attachments` array on the Graph `/me/sendMail`
 * body. Re-enable when the URL-fetch + Graph attachment serialisation flow lands.
 */
export const MICROSOFT_MAX_ATTACHMENT_BYTES = EMAIL_MAX_ATTACHMENT_BYTES

export const microsoftCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  // Graph supports deleting a message.
  deleteMessage: true,
}
