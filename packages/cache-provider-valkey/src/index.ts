import { defineCacheProvider } from '@open-mercato/cache/provider'
import type { CacheProviderDefinition } from '@open-mercato/cache/provider'
import { createRespCacheProvider, createRespStandaloneSettingsSchema } from '@open-mercato/cache-redis-protocol'
import type { RespStandaloneSettings } from '@open-mercato/cache-redis-protocol'

export const VALKEY_CACHE_PROVIDER_ID = 'open-mercato/valkey'

/**
 * Strict settings for the first supported profile: one writable valkey endpoint
 * (standalone), optional ACL username/password, optional TLS and bounded
 * connect/command timeouts. Unknown keys are rejected.
 */
export const settings = createRespStandaloneSettingsSchema()

export type ValkeyCacheProviderSettings = RespStandaloneSettings

export const provider: CacheProviderDefinition<RespStandaloneSettings> = defineCacheProvider(createRespCacheProvider({
  id: VALKEY_CACHE_PROVIDER_ID,
  settings,
  expectedEngine: 'valkey',
}))

export default provider
