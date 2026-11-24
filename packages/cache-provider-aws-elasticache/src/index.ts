import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
import { defineEnterpriseCacheProviderRegistration } from '@open-mercato/cache-provider-managed-kit'
import type { EnterpriseCacheProviderRegistrationOptions } from '@open-mercato/cache-provider-managed-kit'
import { AWS_ELASTICACHE_CACHE_PROVIDER_ID, createAwsElastiCacheProvider } from './provider'

export {
  AWS_DEFAULT_REAUTH_INTERVAL_MS,
  AWS_ELASTICACHE_CACHE_PROVIDER_ID,
  AWS_MAX_REAUTH_INTERVAL_MS,
  createAwsElastiCacheProvider,
  createElastiCacheIamToken,
  createElastiCacheIamTokenSource,
  ELASTICACHE_IAM_TOKEN_TTL_SECONDS,
  ELASTICACHE_SIGNING_SERVICE,
  NodeSha256,
  redactAwsElastiCacheSettings,
  settings,
  toElastiCacheRespSettings,
} from './provider'
export type {
  AwsCredentialIdentity,
  AwsCredentialProvider,
  AwsElastiCacheProviderOptions,
  AwsElastiCacheSettings,
  AwsElastiCacheSettingsInput,
  ElastiCacheIamTokenInput,
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
 * Supported registration path: the provider definition is built and the AWS
 * SDK is imported only after the Enterprise activation gate passes; with the
 * gate closed the app's settings thunk is never evaluated. This is the only
 * supported entry point: the package exports no ungated provider definition.
 * Pass `env` when the host resolves providers with an explicit env.
 */
export function awsElastiCacheCacheProviderRegistration(registration: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration {
  return defineEnterpriseCacheProviderRegistration({
    id: AWS_ELASTICACHE_CACHE_PROVIDER_ID,
    load: async (env) => createAwsElastiCacheProvider({ env }),
    settings: registration.settings,
    ...(registration.env !== undefined ? { env: registration.env } : {}),
  })
}
