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
 * - `threading` — a reply composed with `parentMessageId` arrives in Discord
 *   attached to the message it answers. The hub resolves the parent's Discord
 *   snowflake in `communication_channels/lib/outbound-reply-ref.ts` and writes it
 *   to `channelMetadata.replyToExternalId`; `convertOutbound` turns that into
 *   `messageReferenceId`, and `discord-rest` sends it as `message_reference`.
 *   This flag was `false` for exactly as long as that hub-side producer was
 *   missing (#5541, found against a live bot) — the whole path, not the flag
 *   alone, is pinned by `lib/__tests__/capabilities.test.ts`.
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
 * - `stickers` — no sticker is sent or normalized.
 *
 * AI auto-reply (issue #4778) deliberately flips NONE of these back to `true`.
 * `ChannelCapabilities` describes what the hub may hand this ADAPTER — message
 * shapes, transport features, whether to schedule polling. Auto-reply is not an
 * adapter capability at all: it is a subscriber on the hub's generic
 * `message.received` event that composes a reply through the same outbound path
 * any module uses. Adding a flag for it would tell the hub to route work here
 * that the adapter does not implement, which is exactly the failure mode this
 * list exists to prevent.
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
