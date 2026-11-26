import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from '@open-mercato/cache-provider-managed-kit/registration'
import type { EnterpriseCacheProviderRegistrationOptions } from '@open-mercato/cache-provider-managed-kit/registration'

export const AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID = 'open-mercato/azure-managed-redis' as const

/** Gate the provider import and settings before the selected adapter is evaluated. */
export function azureManagedRedisCacheProviderRegistration(registration: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID,
    load: async (env) => {
      const { createAzureManagedRedisProvider } = await import('./provider')
      return createAzureManagedRedisProvider({ env })
    },
    settings: registration.settings,
    ...(registration.env !== undefined ? { env: registration.env } : {}),
  })
}
