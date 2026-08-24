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
 * - `richText` / `supportedBodyFormats: ['text', 'markdown']` — Discord content
 *   is markdown-native; HTML is down-converted in `convertOutbound`.
 * - `reactions` / `editMessage` / `deleteMessage` — backed by the matching
 *   `discord-rest` calls the adapter exposes.
 * - `conversationHistory` — `fetchHistory` pages `GET /channels/{id}/messages`.
 * - `realtimePush` — the provider owns a long-running Gateway WebSocket worker
 *   that delivers `MESSAGE_CREATE` / reaction events in real time, so the hub's
 *   polling scheduler skips this channel (no redundant `fetchHistory`).
 * - `interactiveComponents` — slash commands, buttons, select menus and modal
 *   submissions round-trip for real: the signed Interactions endpoint answers
 *   with a deferred acknowledgement AND hands the interaction to
 *   `workers/discord-interactions.ts`, which normalizes it into the hub's
 *   existing inbound queue under the matched channel's tenant scope and then
 *   replaces the "thinking…" placeholder over Discord's interaction-webhook
 *   endpoints. Pinned by the parity test in `lib/__tests__/capabilities.test.ts`,
 *   which drives the whole path rather than asserting the flag alone.
 *
 * Deliberately disabled until implemented (declaring them would make the hub
 * hand this adapter work it silently drops):
 * - `threading` — `convertOutbound` reads `channelMetadata.replyToExternalId`
 *   and emits `message_reference` from it, but nothing hub-side ever writes that
 *   key into OUTBOUND metadata: `replyToExternalId` exists only on the inbound
 *   `NormalizedInboundMessage` shape, and the hub's outbound metadata producers
 *   (`send-as-user.ts`, `deliver-outbound-message.ts`) write the email-shaped
 *   `inReplyTo` / `references` instead. The conversion is therefore unreachable
 *   in production — confirmed against a live bot in #5541. The flag flips back
 *   to `true` in the same change that gives the hub an outbound reply producer
 *   this adapter can read, guarded by a contract test.
 * - `fileSharing` / `inlineImages` — `convertOutbound` drops
 *   `input.content.attachments` and `discord-rest` has no multipart upload, so
 *   outbound attachments never reach Discord. `maxFileSize` /
 *   `supportedMimeTypes` are omitted for the same reason.
 * - `typingIndicators` — no `POST /channels/{id}/typing` call exists here.
 * - `presence` — the bot identifies without the `GUILD_PRESENCES` intent and no
 *   presence dispatch is handled.
 * - `richBlocks` — outbound is plain markdown `content`; embeds are not built.
 * - `stickers` — no sticker is sent or normalized.
 */
export const discordCapabilities: ChannelCapabilities = {
  // A Discord recipient is a channel snowflake, never an address. Without this
  // the hub falls back to its `'email'` default and `validateOutboundRecipient`
  // rejects every real recipient with "Recipient must be a valid email address"
  // — which is #4976 still broken for the provider it was filed against, even
  // though #5261 built the mechanism to fix it. The hub then applies transport
  // safety only (allowlist + length), and this adapter owns the format and must
  // keep treating the value as untrusted.
  recipientFormat: 'provider-native',

  // Core
  threading: false,
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
  interactiveComponents: true,
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
