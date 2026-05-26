import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Microsoft 365 / Outlook capabilities. Polling-driven (delta query) for now;
 * Microsoft Graph subscriptions (push notifications) are deferred to v2.
 *
 * Outlook honors RFC2822 In-Reply-To / References natively and adds its own
 * `conversationId` field on each `Message` resource — the adapter prefers
 * the `conversationId` for grouping (parallels Gmail's `threadId`).
 *
 * Microsoft Graph mail attachment limit is 150 MB for FileAttachment via
 * /me/sendMail, but larger attachments require the upload-session endpoint
 * which we don't use here. Stick to 25 MB to match the spec + IMAP/Gmail.
 *
 * `fileSharing: false` (R2-M4 / F11, 2026-05-26): the adapter's
 * `convertOutbound` does not yet populate the `attachments` array on the
 * Graph `/me/sendMail` body. Advertising `true` would lead to silently
 * dropping the bytes. Re-enable when the URL-fetch + Graph attachment
 * serialisation flow lands.
 */
export const MICROSOFT_MAX_ATTACHMENT_BYTES = 25_000_000

export const microsoftCapabilities: ChannelCapabilities = {
  // Core
  threading: true,
  richText: true,
  fileSharing: false,
  maxFileSize: MICROSOFT_MAX_ATTACHMENT_BYTES,
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

  // Polling (Graph subscriptions deferred to v2)
  realtimePush: false,
}
