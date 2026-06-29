import type { ChannelCapabilities } from './adapter'

/**
 * Shared default attachment ceiling for email providers (Gmail allows
 * more, but larger uploads need resumable/upload-session APIs we don't use, so
 * all providers cap at the same conservative value).
 */
export const EMAIL_MAX_ATTACHMENT_BYTES = 25_000_000

/**
 * Baseline capability profile shared by every email channel provider. Providers
 * spread this and override only what genuinely differs (e.g. `deleteMessage`).
 *
 * `fileSharing: false` until a provider's `convertOutbound` stitches attachment
 * bytes into the sent message — advertising `true` would silently drop bytes.
 */
export const baseEmailCapabilities: ChannelCapabilities = {
  // Core
  threading: true,
  richText: true,
  fileSharing: false,
  maxFileSize: EMAIL_MAX_ATTACHMENT_BYTES,
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

  // Body formats
  supportedBodyFormats: ['text', 'html'],
  maxBodyLength: 5_000_000,

  // Polling (real-time push deferred to v2 for all email providers)
  realtimePush: false,
}
