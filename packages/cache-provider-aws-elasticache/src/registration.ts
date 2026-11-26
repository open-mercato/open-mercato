import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from '@open-mercato/cache-provider-managed-kit/registration'
import type { EnterpriseCacheProviderRegistrationOptions } from '@open-mercato/cache-provider-managed-kit/registration'

export const AWS_ELASTICACHE_CACHE_PROVIDER_ID = 'open-mercato/aws-elasticache' as const

/** Gate the provider import and settings before the selected adapter is evaluated. */
export function awsElastiCacheCacheProviderRegistration(registration: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: AWS_ELASTICACHE_CACHE_PROVIDER_ID,
    load: async (env) => {
      const { createAwsElastiCacheProvider } = await import('./provider')
      return createAwsElastiCacheProvider({ env })
    },
    settings: registration.settings,
    ...(registration.env !== undefined ? { env: registration.env } : {}),
  })
}
