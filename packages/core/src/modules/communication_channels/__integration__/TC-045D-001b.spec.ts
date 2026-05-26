import { expect, test } from '@playwright/test'

/**
 * TC-045D-001b — ChannelAdapter registration validates capability/method consistency.
 *
 * SPEC-045d §1.3: the `ChannelAdapterRegistry.register()` MUST call
 * `validateAdapterCapabilities()` and reject any adapter that declares a capability
 * flag set to `true` while omitting the corresponding optional method (e.g.
 * `capabilities.reactions: true` without `sendReaction()` / `removeReaction()`).
 *
 * Comprehensive unit-test coverage of this contract lives in
 * `packages/core/src/modules/communication_channels/lib/__tests__/registry.test.ts` and
 * `lib/__tests__/adapter-compat.test.ts` (12 unit tests across the two files).
 * This Playwright spec is a thin integration sanity check that the registry helpers
 * are exported from the published package surface — i.e. provider packages can import
 * the same types/functions the hub uses.
 */
test.describe('TC-045D-001b: ChannelAdapter registry validation', () => {
  test('registry + validator helpers are exported from the hub module', async () => {
    // Validate that the published export surface compiles and includes the validator.
    // Provider packages (`@open-mercato/channel-slack`, `@open-mercato/channel-whatsapp`)
    // depend on importing these from `@open-mercato/core/modules/communication_channels`.
    const { ChannelAdapterRegistry } = await import(
      '@open-mercato/core/modules/communication_channels/lib/registry'
    )
    const { validateAdapterCapabilities } = await import(
      '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
    )

    expect(typeof ChannelAdapterRegistry).toBe('function')
    expect(typeof validateAdapterCapabilities).toBe('function')

    // Smoke-check that a mismatched adapter is rejected.
    const registry = new ChannelAdapterRegistry()
    const broken: any = {
      providerKey: 'broken_smoke',
      channelType: 'test',
      capabilities: {
        threading: false,
        richText: false,
        fileSharing: false,
        readReceipts: false,
        deliveryReceipts: false,
        typingIndicators: false,
        reactions: true, // claims reactions
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
        supportedBodyFormats: ['text'],
      },
      // ...but does not implement sendReaction / removeReaction
      sendMessage: async () => ({ externalMessageId: 'x', status: 'sent' }),
      verifyWebhook: async () => ({ raw: {} }),
      getStatus: async () => ({ status: 'sent' }),
      convertOutbound: async () => ({ content: {} }),
      normalizeInbound: async (raw: any) => raw,
    }

    expect(() => registry.register(broken)).toThrow(/sendReaction|removeReaction/)
  })
})
