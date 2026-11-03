import { getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'

/**
 * Module-level cache for the editor's scoped reads. The organization scope reads as empty
 * until the switcher reports it on page load, so an entry loaded before that moves to the
 * reported scope instead of emptying the cache and remounting an open form. It stays
 * unconfirmed until a read under that scope succeeds, and a failed read drops it, so a
 * failure can never keep serving data the scope did not confirm. A later switch never
 * inherits anything.
 */
export function createScopedEditorCache<T>(unresolvedKeyFor: (key: string) => string) {
  const entries = new Map<string, T>()
  const unconfirmed = new Set<string>()
  const unresolvedVersions = new Map<string, number>()

  const get = (key: string): T | undefined => {
    const own = entries.get(key)
    const unresolvedKey = unresolvedKeyFor(key)
    if (own !== undefined || key === unresolvedKey) return own
    const early = entries.get(unresolvedKey)
    const loadedAtVersion = unresolvedVersions.get(unresolvedKey) ?? 0
    if (early === undefined || getCurrentOrganizationScopeVersion() > loadedAtVersion + 1) return undefined
    entries.delete(unresolvedKey)
    entries.set(key, early)
    unconfirmed.add(key)
    return early
  }

  return {
    get,
    has: (key: string): boolean => get(key) !== undefined,
    set(key: string, value: T): void {
      entries.set(key, value)
      unconfirmed.delete(key)
      if (key === unresolvedKeyFor(key)) unresolvedVersions.set(key, getCurrentOrganizationScopeVersion())
    },
    clear(): void {
      entries.clear()
      unconfirmed.clear()
      unresolvedVersions.clear()
    },
    dropUnconfirmed(key: string): boolean {
      if (!unconfirmed.delete(key)) return false
      entries.delete(key)
      return true
    },
  }
}
