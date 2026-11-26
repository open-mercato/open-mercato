import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from '@open-mercato/cache-provider-managed-kit/registration'
import type { EnterpriseCacheProviderRegistrationOptions } from '@open-mercato/cache-provider-managed-kit/registration'

export const GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID = 'open-mercato/google-memorystore' as const

/** Gate the provider import and settings before the selected adapter is evaluated. */
export function googleMemorystoreCacheProviderRegistration(registration: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID,
    load: async (env) => {
      const { createGoogleMemorystoreProvider } = await import('./provider')
      return createGoogleMemorystoreProvider({ env })
    },
    settings: registration.settings,
    ...(registration.env !== undefined ? { env: registration.env } : {}),
  })
}
