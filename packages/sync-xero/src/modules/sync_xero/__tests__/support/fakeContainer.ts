import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OAuthStateConsumeStore } from '@open-mercato/core/modules/communication_channels/lib/oauth-state'

/** A container double for route and service tests: only `resolve` and `hasRegistration` are real. */
export function createFakeContainer(registrations: Record<string, unknown>): AppContainer {
  const container = {
    hasRegistration: (name: string) => name in registrations,
    resolve<T>(name: string): T {
      if (!(name in registrations)) throw new Error(`[internal] unexpected resolve: ${name}`)
      return registrations[name] as T
    },
  }
  return container as unknown as AppContainer
}

export type MemoryCache = OAuthStateConsumeStore & { entries: Map<string, unknown>; failSet: boolean }

export function createMemoryCache(): MemoryCache {
  const entries = new Map<string, unknown>()
  const cache: MemoryCache = {
    entries,
    failSet: false,
    async has(key) {
      return entries.has(key)
    },
    async set(key, value) {
      if (cache.failSet) throw new Error('[internal] cache unavailable')
      entries.set(key, value)
    },
  }
  return cache
}
