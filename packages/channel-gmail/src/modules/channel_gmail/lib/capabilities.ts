import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Gmail capabilities. Polling-based for now (`realtimePush: false`) — Pub/Sub
 * push is documented as a v2 follow-up in the email integration spec.
 *
 * Threading is supported natively via Gmail `threadId` plus RFC2822
 * In-Reply-To/References. Gmail attachment limit is 25 MB per the Gmail API
 * docs (uploads >25 MB require the resumable upload API which we don't use).
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's
 * `convertOutbound` does not yet stitch attachment URLs into the base64-encoded
 * RFC2822 body it sends via `users.messages.send`. Advertising `true` would
 * lead to messages being delivered with the attachment metadata implied but
 * the actual bytes silently dropped. Re-enable when the URL-fetch + MIME
 * stitching flow lands.
 */
export const GMAIL_MAX_ATTACHMENT_BYTES = 25_000_000

export const gmailCapabilities: ChannelCapabilities = {
  // Core
  threading: true,
  richText: true,
  fileSharing: false,
  maxFileSize: GMAIL_MAX_ATTACHMENT_BYTES,
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

  // Extended
  reactions: false,
  multiReactionPerUser: false,
  editMessage: false,
  deleteMessage: true,
  presence: false,
  richBlocks: false,
  interactiveComponents: false,
  inlineImages: true,
  conversationHistory: true,
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: false,

  // Body formats
  supportedBodyFormats: ['text', 'html'],
  maxBodyLength: 5_000_000,

  // Polling (Pub/Sub deferred to v2)
  realtimePush: false,
}
