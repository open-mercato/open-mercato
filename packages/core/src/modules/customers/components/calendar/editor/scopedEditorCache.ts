import * as React from 'react'
import {
  readRequestOrganizationScope,
  subscribeOrganizationScopeChanged,
} from '@open-mercato/shared/lib/frontend/organizationEvents'

const UNRESOLVED_SCOPE_KEY = '?'

function readEditorScopeKey(): string {
  const scope = readRequestOrganizationScope()
  return scope ? `${scope.tenantId ?? ''}:${scope.organizationId ?? ''}` : UNRESOLVED_SCOPE_KEY
}

/**
 * The cache key of the scope the editor's reads are sent under. It comes from the scope cookies
 * rather than the switcher's report, so a read made before the report and the report naming the
 * same scope share one key: nothing moves between keys and an open form does not remount.
 */
export function useEditorScopeKey(): string {
  return React.useSyncExternalStore(subscribeOrganizationScopeChanged, readEditorScopeKey, readEditorScopeKey)
}

/**
 * Module-level cache for the editor's scoped reads. An answer is only stored under the key its
 * request was sent with, and an answer for an unresolved scope is never stored, because nothing
 * can prove which organization it belongs to.
 */
export function createScopedEditorCache<T>() {
  const entries = new Map<string, T>()

  return {
    get: (key: string): T | undefined => entries.get(key),
    has: (key: string): boolean => entries.has(key),
    set(key: string, value: T): void {
      if (!key.startsWith(UNRESOLVED_SCOPE_KEY)) entries.set(key, value)
    },
    delete(key: string): void {
      entries.delete(key)
    },
    clear(): void {
      entries.clear()
    },
  }
}
