import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { baseEmailCapabilities } from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'

/**
 * IMAP+SMTP capabilities. Polling-based (no real-time push), threaded via
 * RFC2822 In-Reply-To / References, rich HTML/plain-text body, inline + regular
 * attachments. No reactions, no edit/delete (only the IMAP `\Seen` flag, which
 * the user controls locally and is not reliably surfaced).
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's `sendMessage`
 * fails-fast on attachments (it doesn't yet fetch + inline attachment URLs into
 * MIME bodies). Re-enable when URL-fetch + size-validation lands.
 */
export const imapCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
}
