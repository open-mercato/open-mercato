'use client'
import * as React from 'react'

/**
 * AppShell-owned transport for the current detail record's injection context
 * (Phase 0 / S2). The `backend:record:current` injection spot is mounted once,
 * globally, by `AppShell` — before page `children` — so a page cannot pass props
 * "up" to it. Instead, a detail page publishes its record context through this
 * provider; `AppShell` merges it into the spot's base `{ path, query }` context.
 *
 * Keeps `packages/ui`/core enterprise-free: this is a plain context object, no
 * record_locks dependency, no second `<InjectionSpot>`.
 */
export type RecordInjectionContext = {
  /** record_locks resource key, e.g. `customers.person`, `sales.order`. */
  resourceKind: string
  /** The record's id. */
  resourceId: string
  /** Server `updated_at` (ISO) for the optimistic-lock floor + action-log base. */
  updatedAt?: string | null
  /** Optional record payload for field-level merge UX. */
  data?: Record<string, unknown> | null
  /** The detail screen path this context belongs to (used for stale-context guarding). */
  path?: string | null
}

/**
 * Build a normalized record injection context. Returns `null` when the required
 * keys are missing so callers can publish unconditionally.
 */
export function buildRecordInjectionContext(input: {
  resourceKind: string | null | undefined
  resourceId: string | null | undefined
  updatedAt?: string | Date | null
  data?: Record<string, unknown> | null
  path?: string | null
}): RecordInjectionContext | null {
  const resourceKind = typeof input.resourceKind === 'string' ? input.resourceKind.trim() : ''
  const resourceId = typeof input.resourceId === 'string' ? input.resourceId.trim() : ''
  if (!resourceKind || !resourceId) return null
  const updatedAt = input.updatedAt instanceof Date
    ? input.updatedAt.toISOString()
    : (typeof input.updatedAt === 'string' && input.updatedAt.trim().length ? input.updatedAt.trim() : null)
  return {
    resourceKind,
    resourceId,
    updatedAt,
    data: input.data ?? null,
    path: typeof input.path === 'string' && input.path.length ? input.path : null,
  }
}

type RecordInjectionContextSetter = (context: RecordInjectionContext | null) => void

const BackendRecordInjectionContextSetterContext = React.createContext<RecordInjectionContextSetter | null>(null)

/**
 * AppShell renders this provider around page `children`, supplying the setter
 * that publishes record context into AppShell-owned state. Detail pages call
 * `useSetCurrentRecordInjectionContext()` to publish/clear.
 */
export function BackendRecordInjectionContextProvider({
  setCurrentRecordInjectionContext,
  children,
}: {
  setCurrentRecordInjectionContext: RecordInjectionContextSetter
  children: React.ReactNode
}) {
  return (
    <BackendRecordInjectionContextSetterContext.Provider value={setCurrentRecordInjectionContext}>
      {children}
    </BackendRecordInjectionContextSetterContext.Provider>
  )
}

/**
 * Publish the current detail record's injection context to the AppShell-owned
 * `backend:record:current` mount, and clear it automatically on unmount /
 * dependency change. Pass `null` to clear (e.g. while the record is loading).
 *
 * ```tsx
 * useSetCurrentRecordInjectionContext(
 *   buildRecordInjectionContext({ resourceKind: 'customers.person', resourceId: id, updatedAt, data, path }),
 * )
 * ```
 */
export function useSetCurrentRecordInjectionContext(context: RecordInjectionContext | null): void {
  const setter = React.useContext(BackendRecordInjectionContextSetterContext)
  // Serialize so we only re-publish when the meaningful fields change.
  const serialized = context
    ? JSON.stringify({ k: context.resourceKind, i: context.resourceId, u: context.updatedAt ?? null, p: context.path ?? null })
    : null
  React.useEffect(() => {
    if (!setter) return
    setter(context)
    return () => {
      setter(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setter, serialized])
}
