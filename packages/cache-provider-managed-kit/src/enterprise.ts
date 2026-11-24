import { CacheProviderError, defineCacheProvider, defineCacheProviderRegistration } from '@open-mercato/cache/provider'
import type {
  CacheProviderDefinition,
  CacheProviderEnv,
  CacheProviderRegistration,
  CacheProviderSettingsParseResult,
} from '@open-mercato/cache/provider'

export const ENTERPRISE_MODULES_ENV = 'OM_ENABLE_ENTERPRISE_MODULES'
export const ENTERPRISE_CACHE_PROVIDERS_ENV = 'OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS'

export const OFFICIAL_MANAGED_CACHE_PROVIDER_IDS = [
  'open-mercato/azure-managed-redis',
  'open-mercato/aws-elasticache',
  'open-mercato/google-memorystore',
] as const

export type OfficialManagedCacheProviderId = typeof OFFICIAL_MANAGED_CACHE_PROVIDER_IDS[number]

const TRUE_TOKENS = new Set(['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'])

function isTrue(raw: string | undefined): boolean {
  return typeof raw === 'string' && TRUE_TOKENS.has(raw.trim().toLowerCase())
}

export function isOfficialManagedCacheProviderId(id: unknown): id is OfficialManagedCacheProviderId {
  return typeof id === 'string' && (OFFICIAL_MANAGED_CACHE_PROVIDER_IDS as ReadonlyArray<string>).includes(id)
}

/**
 * Runtime enable flag for the official managed cache providers. Mirrors the
 * Enterprise module opt-in (`OM_ENABLE_ENTERPRISE_MODULES` plus a dedicated
 * sub-flag). Commercial package access and entitlement belong to the
 * Enterprise distribution process; this switch alone is not a license.
 */
export function isEnterpriseCacheProviderActivationEnabled(env: CacheProviderEnv = process.env): boolean {
  return isTrue(env[ENTERPRISE_MODULES_ENV]) && isTrue(env[ENTERPRISE_CACHE_PROVIDERS_ENV])
}

export function enterpriseActivationError(providerId: OfficialManagedCacheProviderId): CacheProviderError {
  return new CacheProviderError(
    'unavailable',
    `Cache provider "${providerId}" is an Open Mercato Enterprise managed cache provider and is not activated. `
      + `Set ${ENTERPRISE_MODULES_ENV}=true and ${ENTERPRISE_CACHE_PROVIDERS_ENV}=true in a licensed Enterprise deployment `
      + `(web, workers and maintenance commands alike), or select another cache provider. `
      + 'No cloud connection was attempted and no local cache fallback is used.',
    { providerId },
  )
}

export function assertEnterpriseCacheProviderActivation(
  providerId: OfficialManagedCacheProviderId,
  env: CacheProviderEnv = process.env,
): void {
  if (!isEnterpriseCacheProviderActivationEnabled(env)) throw enterpriseActivationError(providerId)
}

export const ENTERPRISE_DISABLED_CONFIG: Readonly<{ enterpriseActivation: 'disabled' }> = Object.freeze({ enterpriseActivation: 'disabled' as const })

export type EnterpriseDisabledConfig = typeof ENTERPRISE_DISABLED_CONFIG

export function isEnterpriseDisabledConfig(config: unknown): config is EnterpriseDisabledConfig {
  return config === ENTERPRISE_DISABLED_CONFIG
}

/**
 * Stand-in definition returned while the gate is closed: it never inspects the
 * settings input, never imports the provider implementation or a cloud SDK and
 * fails `create()` with an actionable `unavailable` error.
 */
export function createDisabledEnterpriseCacheProvider(providerId: OfficialManagedCacheProviderId): CacheProviderDefinition<EnterpriseDisabledConfig> {
  return defineCacheProvider<EnterpriseDisabledConfig>({
    id: providerId,
    settings: {
      safeParse: (): CacheProviderSettingsParseResult<EnterpriseDisabledConfig> => ({ success: true, data: ENTERPRISE_DISABLED_CONFIG }),
    },
    capability: () => ({ placement: 'shared' }),
    create: () => {
      throw enterpriseActivationError(providerId)
    },
    redact: () => ({ enterpriseActivation: 'disabled' }),
  })
}

/**
 * Wrap an official managed provider definition so the activation gate runs
 * before settings validation (no settings access) and again before any client
 * or SDK work in `create()`.
 */
export function gateEnterpriseCacheProvider<TConfig>(
  providerId: OfficialManagedCacheProviderId,
  definition: CacheProviderDefinition<TConfig>,
  env?: CacheProviderEnv,
): CacheProviderDefinition<TConfig> {
  const readEnv = (): CacheProviderEnv => env ?? process.env
  return {
    ...definition,
    settings: {
      safeParse(input: unknown): CacheProviderSettingsParseResult<TConfig> {
        if (!isEnterpriseCacheProviderActivationEnabled(readEnv())) {
          return { success: true, data: ENTERPRISE_DISABLED_CONFIG as unknown as TConfig }
        }
        return definition.settings.safeParse(input)
      },
    },
    capability(config) {
      if (isEnterpriseDisabledConfig(config)) return { placement: 'shared' }
      return definition.capability(config)
    },
    async create(config, context) {
      assertEnterpriseCacheProviderActivation(providerId, readEnv())
      if (isEnterpriseDisabledConfig(config)) throw enterpriseActivationError(providerId)
      return definition.create(config, context)
    },
    redact(config) {
      if (isEnterpriseDisabledConfig(config)) return { enterpriseActivation: 'disabled' }
      return definition.redact ? definition.redact(config) : {}
    },
  }
}

export type EnterpriseCacheProviderRegistrationOptions = {
  settings: () => unknown
  /**
   * Environment the activation gate reads — pass the same env given to
   * `resolveCacheProvider({ env })`. Defaults to `process.env` at call time.
   */
  env?: CacheProviderEnv
}

/**
 * Registration helper for official managed providers. With the gate closed the
 * provider package (and its cloud SDK) is not imported and the app's settings
 * thunk is not evaluated; selection then fails with a sanitized `unavailable`
 * error at cache initialization in web, worker and maintenance paths alike.
 * `load` receives the gate env so the loaded definition gates on the same env.
 */
export function defineEnterpriseCacheProviderRegistration<TConfig>(registration: {
  id: OfficialManagedCacheProviderId
  load: (env: CacheProviderEnv) => Promise<CacheProviderDefinition<TConfig>>
  settings: () => unknown
  env?: CacheProviderEnv
}): CacheProviderRegistration {
  if (!isOfficialManagedCacheProviderId(registration.id)) {
    throw new CacheProviderError('invalid_registration', 'Enterprise cache provider registrations must use an official managed provider id')
  }
  const providerId = registration.id
  const readEnv = (): CacheProviderEnv => registration.env ?? process.env
  return defineCacheProviderRegistration<unknown>({
    id: providerId,
    load: async () => {
      const env = readEnv()
      if (!isEnterpriseCacheProviderActivationEnabled(env)) return createDisabledEnterpriseCacheProvider(providerId) as CacheProviderDefinition<unknown>
      return (await registration.load(env)) as CacheProviderDefinition<unknown>
    },
    settings: () => (isEnterpriseCacheProviderActivationEnabled(readEnv()) ? registration.settings() : undefined),
  })
}
