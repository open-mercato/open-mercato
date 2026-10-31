import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { baseEmailCapabilities } from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'

/**
 * Microsoft 365 capabilities. Polling-driven (`realtimePush: false` from the
 * shared baseline) — Graph change notifications are a phase-2 follow-up, see
 * `.ai/specs/2026-09-04-ms365-graph-email-channel.md` § Phase plan.
 *
 * Threading is carried by RFC2822 `In-Reply-To` / `References` inside the raw
 * MIME we send and receive; Exchange threads on the same headers and assigns
 * its own `conversationId`, which we keep as metadata only.
 *
 * `fileSharing: false` matches Gmail/IMAP: the shared outbound converter does
 * not stitch attachment bytes into the MIME body yet.
 */
export const ms365Capabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  // Graph lets us move a message to Deleted Items (soft delete, user-restorable).
  deleteMessage: true,
}
