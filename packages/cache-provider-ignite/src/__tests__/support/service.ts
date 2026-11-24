import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderRegistration, resolveCacheProvider, type ResolvedCacheProvider } from '@open-mercato/cache/provider'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { spawnConformanceRemoteProcess, type ConformanceRemoteProcess } from '@open-mercato/cache/testing/remote'
import { IGNITE_PROVIDER_ID, provider, type IgniteCacheProviderConfig, type IgniteCacheProviderSettingsInput } from '../../index'

export function igniteRegistration(settings: () => unknown) {
  return defineCacheProviderRegistration<IgniteCacheProviderConfig>({
    id: IGNITE_PROVIDER_ID,
    load: async () => provider,
    settings,
  })
}

export async function resolveIgnite(namespace: string, settings: IgniteCacheProviderSettingsInput): Promise<ResolvedCacheProvider> {
  const resolved = await resolveCacheProvider([igniteRegistration(() => settings)], {
    env: { CACHE_PROVIDER: IGNITE_PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: namespace },
  })
  if (!resolved) throw new Error('[internal] Ignite provider was not selected')
  return resolved
}

export async function createIgniteService(
  namespace: string,
  settings: IgniteCacheProviderSettingsInput,
  options: { defaultTtl?: number } = {},
): Promise<CacheStrategy> {
  return createCacheService({
    provider: await resolveIgnite(namespace, settings),
    ...(options.defaultTtl !== undefined ? { defaultTtl: options.defaultTtl } : {}),
  })
}

export function childEnv(namespace: string, settings: IgniteCacheProviderSettingsInput, extra: Record<string, string> = {}) {
  return {
    OM_IGNITE_TEST_SETTINGS: JSON.stringify(settings),
    CACHE_PROVIDER: IGNITE_PROVIDER_ID,
    CACHE_PROVIDER_NAMESPACE: namespace,
    ...extra,
  }
}

export function spawnIgniteChild(
  childModule: string,
  namespace: string,
  settings: IgniteCacheProviderSettingsInput,
): Promise<ConformanceRemoteProcess> {
  return spawnConformanceRemoteProcess({
    command: process.execPath,
    args: [childModule],
    env: childEnv(namespace, settings),
    readyTimeoutMs: 60_000,
  })
}
