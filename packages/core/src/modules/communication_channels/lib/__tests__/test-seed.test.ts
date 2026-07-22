import {
  TEST_CHANNEL_SEEDING_ENV,
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
