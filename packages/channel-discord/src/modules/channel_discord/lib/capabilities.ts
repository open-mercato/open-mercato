import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'

/**
 * Discord message content hard limit — the REST API rejects `content` longer
 * than 2000 characters (embeds have their own separate budget we don't use here).
 */
export const DISCORD_MAX_BODY_LENGTH = 2000

/**
 * Discord capability profile (SPEC 2026-06-19 § Adapter method map).
 *
 * The hub treats these flags as a contract: it routes work to the adapter based
 * on them, so each one describes what THIS adapter implements today, not what
 * the Discord API is able to do. Everything the first release does not implement
 * is declared `false` and stays `false` until the corresponding code lands.
 *
 * Enabled, with the implementation behind each:
 * - `threading` — `convertOutbound` emits `message_reference`, so a reply is
 *   attached to the message it answers.
 * - `richText` / `supportedBodyFormats: ['text', 'markdown']` — Discord content
 *   is markdown-native; HTML is down-converted in `convertOutbound`.
 * - `reactions` / `editMessage` / `deleteMessage` — backed by the matching
 *   `discord-rest` calls the adapter exposes.
 * - `conversationHistory` — `fetchHistory` pages `GET /channels/{id}/messages`.
 * - `realtimePush` — the provider owns a long-running Gateway WebSocket worker
 *   that delivers `MESSAGE_CREATE` / reaction events in real time, so the hub's
 *   polling scheduler skips this channel (no redundant `fetchHistory`).
 *
 * Deliberately disabled until implemented (declaring them would make the hub
 * hand this adapter work it silently drops):
 * - `fileSharing` / `inlineImages` — `convertOutbound` drops
 *   `input.content.attachments` and `discord-rest` has no multipart upload, so
 *   outbound attachments never reach Discord. `maxFileSize` /
 *   `supportedMimeTypes` are omitted for the same reason.
 * - `typingIndicators` — no `POST /channels/{id}/typing` call exists here.
 * - `presence` — the bot identifies without the `GUILD_PRESENCES` intent and no
 *   presence dispatch is handled.
 * - `richBlocks` — outbound is plain markdown `content`; embeds are not built.
 * - `interactiveComponents` — the Interactions endpoint verifies the signature
 *   and answers with a deferred ack only; it never sends components or a
 *   follow-up, so nothing interactive round-trips yet.
 * - `stickers` — no sticker is sent or normalized.
 */
export const discordCapabilities: ChannelCapabilities = {
  // Core
  threading: true,
  richText: true,
  fileSharing: false,
  readReceipts: false,
  deliveryReceipts: false,
  typingIndicators: false,

  // Extended
  reactions: true,
  multiReactionPerUser: false,
  editMessage: true,
  deleteMessage: true,
  presence: false,
  richBlocks: false,
  interactiveComponents: false,
  inlineImages: false,
  conversationHistory: true,
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: false,

  // Content format support
  supportedBodyFormats: ['text', 'markdown'],
  maxBodyLength: DISCORD_MAX_BODY_LENGTH,

  // The gateway worker is the real-time source; the hub must not schedule polling.
  realtimePush: true,
}
