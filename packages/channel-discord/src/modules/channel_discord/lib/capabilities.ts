import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Default Discord attachment ceiling for the free server tier (8 MB). Larger
 * uploads require Nitro-boosted guilds or the resumable upload flow we don't use,
 * so we advertise the conservative baseline.
 */
export const DISCORD_MAX_ATTACHMENT_BYTES = 8_000_000

/**
 * Discord message content hard limit — the REST API rejects `content` longer
 * than 2000 characters (embeds have their own separate budget we don't use here).
 */
export const DISCORD_MAX_BODY_LENGTH = 2000

/**
 * Discord capability profile (SPEC 2026-06-19 § Adapter method map).
 *
 * - `realtimePush: true` — the provider owns a long-running Gateway WebSocket
 *   worker that delivers `MESSAGE_CREATE` / reaction events in real time, so the
 *   hub's polling scheduler skips this channel (no redundant `fetchHistory`).
 * - `supportedBodyFormats: ['text', 'markdown']` — Discord content is
 *   markdown-native; HTML is down-converted in `convertOutbound`.
 * - `interactiveComponents: true` — slash commands + buttons arrive over the
 *   signed Interactions endpoint.
 */
export const discordCapabilities: ChannelCapabilities = {
  // Core
  threading: true,
  richText: true,
  fileSharing: true,
  maxFileSize: DISCORD_MAX_ATTACHMENT_BYTES,
  supportedMimeTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/zip',
    'application/octet-stream',
    'text/plain',
  ],
  readReceipts: false,
  deliveryReceipts: false,
  typingIndicators: true,

  // Extended
  reactions: true,
  multiReactionPerUser: false,
  editMessage: true,
  deleteMessage: true,
  presence: true,
  richBlocks: true,
  interactiveComponents: true,
  inlineImages: true,
  conversationHistory: true,
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: true,

  // Content format support
  supportedBodyFormats: ['text', 'markdown'],
  maxBodyLength: DISCORD_MAX_BODY_LENGTH,

  // The gateway worker is the real-time source; the hub must not schedule polling.
  realtimePush: true,
}
