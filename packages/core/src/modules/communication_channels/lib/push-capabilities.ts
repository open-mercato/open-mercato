import type { ChannelCapabilities } from './adapter'

/**
 * Baseline capability profile shared by every mobile-push channel provider
 * (FCM / APNs / Expo) and the test-only `push_stub` adapter. Mirrors the
 * `baseEmailCapabilities` pattern so the push contract has a single source of
 * truth: push is a fire-and-forget outbound channel with no threading, history,
 * reactions, or rich content, and it is real-time (`realtimePush: true`) so the
 * hub never schedules polling for it.
 *
 * Providers spread this and override only what genuinely differs.
 */
export const pushChannelCapabilities: ChannelCapabilities = {
  // Core
  threading: false,
  richText: false,
  fileSharing: false,
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
  inlineImages: false,
  conversationHistory: false,
  contactCards: false,
  locationSharing: false,
  voiceNotes: false,
  stickers: false,

  // Body formats
  supportedBodyFormats: ['text'],

  // Push is real-time; no polling.
  realtimePush: true,
}
