import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * IMAP+SMTP capabilities. Polling-based (no real-time push), threaded via
 * RFC2822 In-Reply-To / References, rich HTML/plain-text body, inline + regular
 * attachments. No reactions, no edit/delete, no read receipts beyond the
 * IMAP `\Seen` flag (which the user controls locally and is not reliably surfaced).
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's `sendMessage`
 * fails-fast on attachments (it currently doesn't fetch and inline attachment
 * URLs into MIME bodies). Advertising `true` while the runtime rejects sends
 * is worse than honest `false`. Re-enable when URL-fetch + size-validation
 * lands.
 */
export const IMAP_MAX_ATTACHMENT_BYTES = 25_000_000

export const imapCapabilities: ChannelCapabilities = {
  // Core
  threading: true,
  richText: true,
  fileSharing: false,
  maxFileSize: IMAP_MAX_ATTACHMENT_BYTES,
  supportedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/zip',
    'application/octet-stream',
    'text/plain',
    'text/html',
    'text/csv',
  ],
  readReceipts: false,
  deliveryReceipts: false,
  typingIndicators: false,

  // Extended — email doesn't natively support these
  reactions: false,
  multiReactionPerUser: false,
  editMessage: false,
  deleteMessage: false,
  presence: false,
  richBlocks: false,
  interactiveComponents: false,
  inlineImages: true,
  conversationHistory: true,
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: false,

  // Body formats — email supports plain text + HTML
  supportedBodyFormats: ['text', 'html'],
  maxBodyLength: 5_000_000,

  // Polling, not push
  realtimePush: false,
}
