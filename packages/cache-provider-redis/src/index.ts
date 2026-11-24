import { defineCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition } from '@open-mercato/cache/provider'
import { createRespCacheProvider, createRespStandaloneSettingsSchema } from '@open-mercato/cache-redis-protocol'
import type { RespStandaloneSettings } from '@open-mercato/cache-redis-protocol'

export const REDIS_CACHE_PROVIDER_ID = 'open-mercato/redis'

/**
 * Strict settings for the first supported profile: one writable redis endpoint
 * (standalone), optional ACL username/password, optional TLS and bounded
 * connect/command timeouts. Unknown keys are rejected.
 */
export const settings = createRespStandaloneSettingsSchema()

export type RedisCacheProviderSettings = RespStandaloneSettings

export const provider: CacheProviderDefinition<RespStandaloneSettings> = defineCacheProvider(createRespCacheProvider({
  id: REDIS_CACHE_PROVIDER_ID,
  settings,
  expectedEngine: 'redis',
}))

export default provider
