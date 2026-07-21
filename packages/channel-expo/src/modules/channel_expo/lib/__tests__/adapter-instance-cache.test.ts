import { getExpoChannelAdapter } from '../adapter'
import type { SendMessageInput } from '@open-mercato/core/modules/communication_channels/lib/adapter'

// Drive the REAL default client factory (no setExpoClientFactory override) so the module-level
// instance cache in getExpoInstance is exercised. Mock the SDK so each `new Expo(...)` is countable.
let constructionCount = 0

jest.mock('expo-server-sdk', () => {
  class FakeExpo {
    constructor(_options: { accessToken?: string }) {
      constructionCount += 1
    }
    static isExpoPushToken(): boolean {
      return true
    }
    async sendPushNotificationsAsync(): Promise<Array<{ status: string; id: string }>> {
      return [{ status: 'ok', id: 'ticket' }]
    }
  }
  return { Expo: FakeExpo }
})

function buildInputForToken(accessToken: string): SendMessageInput {
  return {
    content: {
      text: 'Body text',
      bodyFormat: 'text',
      raw: { title: 'Hello', body: 'Body text', data: { type: 'orders.shipped', notificationId: 'n1' } },
    },
    credentials: { accessToken },
    scope: { tenantId: 't1', organizationId: 'o1' },
    metadata: { pushToken: 'ExponentPushToken[abc]', platform: 'ios' },
  }
}

describe('ExpoChannelAdapter default instance cache', () => {
  const INSTANCE_CACHE_MAX = 32

  it('bounds the cache with an LRU: reuses cached instances, evicts the oldest past the cap', async () => {
    const adapter = getExpoChannelAdapter()

    // Fill the cache to its cap with distinct access tokens (distinct cache key → distinct instance).
    for (let index = 0; index < INSTANCE_CACHE_MAX; index += 1) {
      const result = await adapter.sendMessage(buildInputForToken(`token-${index}`))
      expect(result.status).toBe('sent')
    }
    expect(constructionCount).toBe(INSTANCE_CACHE_MAX)

    // Re-sending with a token already cached reuses its instance — no new construction.
    await adapter.sendMessage(buildInputForToken('token-5'))
    expect(constructionCount).toBe(INSTANCE_CACHE_MAX)

    // The (cap + 1)-th distinct token exceeds the bound and evicts the oldest entry (token-0).
    await adapter.sendMessage(buildInputForToken('token-overflow'))
    expect(constructionCount).toBe(INSTANCE_CACHE_MAX + 1)

    // token-0 was evicted, so using it again re-constructs a fresh instance...
    await adapter.sendMessage(buildInputForToken('token-0'))
    expect(constructionCount).toBe(INSTANCE_CACHE_MAX + 2)

    // ...while a token still resident in the cache is served without re-construction.
    await adapter.sendMessage(buildInputForToken('token-overflow'))
    expect(constructionCount).toBe(INSTANCE_CACHE_MAX + 2)
  })
})
