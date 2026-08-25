import {
  TEST_CHANNEL_SEEDING_ENV,
  TEST_SEED_CHAT_PROVIDER_KEY,
  TEST_SEED_PROVIDER_KEY,
  ensureTestSeedAdapterRegistered,
  isTestChannelSeedingEnabled,
} from '../test-seed'
import { clearChannelAdapters, hasChannelAdapter, getChannelAdapter } from '../registry'

describe('communication_channels test-seed gate', () => {
  const originalFlag = process.env[TEST_CHANNEL_SEEDING_ENV]

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[TEST_CHANNEL_SEEDING_ENV]
    else process.env[TEST_CHANNEL_SEEDING_ENV] = originalFlag
    clearChannelAdapters()
  })

  describe('isTestChannelSeedingEnabled', () => {
    it('is false when the env flag is unset (production default)', () => {
      delete process.env[TEST_CHANNEL_SEEDING_ENV]
      expect(isTestChannelSeedingEnabled()).toBe(false)
    })

    it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])(
      'is true for truthy token %p',
      (token) => {
        process.env[TEST_CHANNEL_SEEDING_ENV] = token
        expect(isTestChannelSeedingEnabled()).toBe(true)
      },
    )

    it.each(['0', 'false', 'no', 'off', '', 'enabled', 'maybe'])(
      'is false for non-truthy token %p',
      (token) => {
        process.env[TEST_CHANNEL_SEEDING_ENV] = token
        expect(isTestChannelSeedingEnabled()).toBe(false)
      },
    )
  })

  describe('ensureTestSeedAdapterRegistered', () => {
    it('does NOT register the stub adapter when the gate is off (prod safety)', () => {
      delete process.env[TEST_CHANNEL_SEEDING_ENV]
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      expect(hasChannelAdapter(TEST_SEED_PROVIDER_KEY)).toBe(false)
      expect(hasChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)).toBe(false)
    })

    it('registers a non-email chat stub alongside the email one (#4975)', () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'true'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)
      expect(adapter).toBeDefined()
      // The whole point: a stub whose channelType is NOT email, so a test can
      // prove the hub accepts a sender that has no address instead of feeding
      // it an invented one.
      expect(adapter?.channelType).not.toBe('email')
      expect(adapter?.capabilities.conversationHistory).toBe(false)
    })

    it('the chat stub normalizes a frame carrying no address at all', async () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'true'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)

      const normalized = await adapter!.normalizeInbound({
        raw: {
          externalMessageId: 'chat-message-1',
          externalConversationId: 'chat-conversation-1',
          senderIdentifier: '1499156851487539260',
          senderDisplayName: 'Karol Kapsa',
          body: 'hello from a guild channel',
        },
        eventType: 'message',
        metadata: {},
      })

      expect(normalized.senderIdentifier).toBe('1499156851487539260')
      expect(JSON.stringify(normalized)).not.toContain('@')
      expect((normalized as { subject?: string }).subject).toBeUndefined()
    })

    it('registers a network-free email stub adapter when the gate is on', () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'true'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_PROVIDER_KEY)
      expect(adapter).toBeDefined()
      expect(adapter?.channelType).toBe('email')
      // conversationHistory must be false so the strict registry validator does
      // not require a fetchHistory() implementation on the stub.
      expect(adapter?.capabilities.conversationHistory).toBe(false)
    })

    it('is idempotent — repeated calls do not throw a duplicate registration', () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = '1'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      expect(() => ensureTestSeedAdapterRegistered()).not.toThrow()
      expect(hasChannelAdapter(TEST_SEED_PROVIDER_KEY)).toBe(true)
    })

    it('the stub sendMessage reports success without network I/O', async () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'on'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_PROVIDER_KEY)
      expect(adapter).toBeDefined()
      const result = await adapter!.sendMessage({
        conversationId: 'conv-1',
        content: { text: 'hi', bodyFormat: 'text' },
        credentials: {},
        scope: { tenantId: 't', organizationId: 'o' },
      })
      expect(result.status).toBe('sent')
      expect(typeof result.externalMessageId).toBe('string')
      expect(result.externalMessageId.length).toBeGreaterThan(0)
    })
  })
})
