import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { baseEmailCapabilities } from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'

/**
 * IMAP+SMTP capabilities. Polling-based (no real-time push), threaded via
 * RFC2822 In-Reply-To / References, rich HTML/plain-text body, inline + regular
 * attachments. No reactions, no edit/delete (only the IMAP `\Seen` flag, which
 * the user controls locally and is not reliably surfaced).
 *
 * `fileSharing: true`: `sendMessage` hands nodemailer the attachment bytes the
 * hub reads from the attachments module; a remote attachment URL is refused.
 */
export const imapCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  fileSharing: true,
}
