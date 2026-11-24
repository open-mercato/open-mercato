import type { CacheProviderDefinition, CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from '@open-mercato/cache-provider-managed-kit'
import { AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID, createAzureManagedRedisProvider } from './provider'
import type { AzureManagedRedisSettings } from './provider'

export {
  AZURE_DEFAULT_REAUTH_INTERVAL_MS,
  AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID,
  AZURE_MANAGED_REDIS_DEFAULT_PORT,
  AZURE_REDIS_ENTRA_SCOPE,
  createAzureManagedRedisProvider,
  createEntraTokenSource,
  decodeJwtObjectId,
  redactAzureManagedRedisSettings,
  settings,
  toAzureRespSettings,
} from './provider'
export type {
  AzureAccessToken,
  AzureManagedRedisProviderOptions,
  AzureManagedRedisSettings,
  AzureManagedRedisSettingsInput,
  AzureTokenCredential,
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
export type { OfficialManagedCacheProviderId } from '@open-mercato/cache-provider-managed-kit'
export type { ManagedAccessToken, ManagedAccessTokenSource } from '@open-mercato/cache-provider-managed-kit'

export const provider: CacheProviderDefinition<AzureManagedRedisSettings> = createAzureManagedRedisProvider()

export default provider

/**
 * Supported registration path: the provider definition is built and
 * `@azure/identity` is imported only after the Enterprise activation gate passes;
 * with the gate closed the app's settings thunk is never evaluated.
 */
export function azureManagedRedisCacheProviderRegistration(registration: { settings: () => unknown }): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: AZURE_MANAGED_REDIS_CACHE_PROVIDER_ID,
    load: async () => createAzureManagedRedisProvider(),
    settings: registration.settings,
  })
}
