import { createCacheService } from '@open-mercato/cache/service'
import { defineCacheProviderRegistration, resolveCacheProvider } from '@open-mercato/cache/provider'
import { spawnConformanceRemoteProcess, type ConformanceRemoteProcess } from '@open-mercato/cache/testing'
import type { CacheStrategy } from '@open-mercato/cache/types'
import { provider } from '../../provider'
import { CHILD_RUNNER } from './bundle'

export const PROVIDER_ID = 'open-mercato/infinispan'

export async function openService(settings: Record<string, unknown>, namespace: string, defaultTtl?: number): Promise<CacheStrategy> {
  const resolved = await resolveCacheProvider([
    defineCacheProviderRegistration({ id: PROVIDER_ID, load: async () => provider, settings: () => settings }),
  ], { env: { CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: namespace } })
  if (!resolved) throw new Error('[internal] provider not selected')
  return createCacheService({ provider: resolved, ...(defaultTtl !== undefined ? { defaultTtl } : {}) })
}

export function spawnRemote(bundle: string, settings: Record<string, unknown>, namespace: string): Promise<ConformanceRemoteProcess> {
  return spawnConformanceRemoteProcess({
    command: process.execPath,
    args: [CHILD_RUNNER],
    env: {
      CACHE_CONFORMANCE_BUNDLE: bundle,
      CACHE_CONFORMANCE_SETTINGS: JSON.stringify(settings),
      CACHE_PROVIDER: PROVIDER_ID,
      CACHE_PROVIDER_NAMESPACE: namespace,
    },
    readyTimeoutMs: 60_000,
  })
}
