import type { OAuthStateConsumeStore } from '@open-mercato/core/modules/communication_channels/lib/oauth-state'

export type FakeContainer = {
  registrations: Record<string, unknown>
  hasRegistration(name: string): boolean
  resolve<T = unknown>(name: string): T
}

export function createFakeContainer(registrations: Record<string, unknown>): FakeContainer {
  return {
    registrations,
    hasRegistration: (name) => name in registrations,
    resolve<T>(name: string): T {
      if (!(name in registrations)) throw new Error(`[internal] unexpected resolve: ${name}`)
      return registrations[name] as T
    },
  }
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
