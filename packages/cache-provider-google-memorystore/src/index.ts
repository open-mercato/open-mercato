import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from '@open-mercato/cache-provider-managed-kit'
import type { EnterpriseCacheProviderRegistrationOptions } from '@open-mercato/cache-provider-managed-kit'
import { createGoogleMemorystoreProvider, GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID } from './provider'

export {
  createGoogleIamTokenSource,
  createGoogleMemorystoreProvider,
  GOOGLE_CLOUD_PLATFORM_SCOPE,
  GOOGLE_DEFAULT_REAUTH_INTERVAL_MS,
  GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID,
  redactGoogleMemorystoreSettings,
  settings,
  toMemorystoreRespSettings,
} from './provider'
export type {
  GoogleAccessTokenClient,
  GoogleMemorystoreProviderOptions,
  GoogleMemorystoreSettings,
  GoogleMemorystoreSettingsInput,
} from './provider'
export {
  assertEnterpriseCacheProviderActivation,
  createDisabledEnterpriseCacheProvider,
  defineEnterpriseCacheProviderRegistration,
  ENTERPRISE_CACHE_PROVIDERS_ENV,
  ENTERPRISE_MODULES_ENV,
  isEnterpriseCacheProviderActivationEnabled,
  OFFICIAL_MANAGED_CACHE_PROVIDER_IDS,
} from '@open-mercato/cache-provider-managed-kit'
export type { EnterpriseCacheProviderRegistrationOptions, OfficialManagedCacheProviderId } from '@open-mercato/cache-provider-managed-kit'
export type { ManagedAccessToken, ManagedAccessTokenSource } from '@open-mercato/cache-provider-managed-kit'

/**
 * Supported registration path: the provider definition is built and
 * `google-auth-library` is imported only after the Enterprise activation gate
 * passes; with the gate closed the app's settings thunk is never evaluated. This is the
 * only supported entry point: the package exports no ungated provider
 * definition. Pass `env` when the host resolves providers with an explicit env.
 */
export function googleMemorystoreCacheProviderRegistration(registration: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID,
    load: async (env) => createGoogleMemorystoreProvider({ env }),
    settings: registration.settings,
    ...(registration.env !== undefined ? { env: registration.env } : {}),
  })
}
