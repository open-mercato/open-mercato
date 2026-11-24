import type { CacheProviderDefinition, CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from './enterprise'
import { createGoogleMemorystoreProvider, GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID } from './provider'
import type { GoogleMemorystoreSettings } from './provider'

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
} from './enterprise'
export type { OfficialManagedCacheProviderId } from './enterprise'
export type { ManagedAccessToken, ManagedAccessTokenSource } from './credentials'

export const provider: CacheProviderDefinition<GoogleMemorystoreSettings> = createGoogleMemorystoreProvider()

export default provider

/**
 * Supported registration path: the provider definition is built and
 * `google-auth-library` is imported only after the Enterprise activation gate
 * passes; with the gate closed the app's settings thunk is never evaluated.
 */
export function googleMemorystoreCacheProviderRegistration(registration: { settings: () => unknown }): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: GOOGLE_MEMORYSTORE_CACHE_PROVIDER_ID,
    load: async () => createGoogleMemorystoreProvider(),
    settings: registration.settings,
  })
}
