"use client"

import { useEffect, useRef } from 'react'

/**
 * Autosave loop primitive.
 *
 * Calls `onFlush` after `intervalMs` of quiescence. Resetting `dirtyKey`
 * (e.g. by bumping a counter when a field changes) restarts the timer. Any
 * caller that disables autosave (e.g. submitting state) should pass
 * `enabled: false`.
 *
 * R-1d-1 mitigation: the hook only observes the latest `onFlush` reference;
 * conflict resolution is the caller's responsibility (it refetches and merges
 * dirty fields onto the fresh base).
 */
export type UseAutosaveOptions = {
  /** Bumps to indicate new local edits are pending. */
  dirtyKey: number
  /** Disable the hook (e.g. while saving, conflict-resolving, or completed). */
  enabled: boolean
  /** Debounce window. */
  intervalMs: number
  /** Persistence callback — return a promise; rejection is the caller's problem. */
  onFlush: () => void | Promise<void>
}

export function useAutosave({ dirtyKey, enabled, intervalMs, onFlush }: UseAutosaveOptions): void {
  const flushRef = useRef(onFlush)
  flushRef.current = onFlush

  useEffect(() => {
    if (!enabled) return
    if (dirtyKey <= 0) return
    const handle = setTimeout(() => {
      const result = flushRef.current()
      if (result && typeof (result as Promise<void>).then === 'function') {
        ;(result as Promise<void>).catch(() => {
          /* error states are tracked by the caller */
        })
      }
    }, intervalMs)
    return () => clearTimeout(handle)
  }, [dirtyKey, enabled, intervalMs])
}

/**
 * Conflict merge: prefers locally-dirty values, otherwise takes the fresh
 * server state. Returns the merged record plus the set of fields where the
 * remote value diverged from the local value (these are the user-prompt
 * candidates).
 */
export function mergeOnConflict(args: {
  localDirty: Record<string, unknown>
  baseSnapshot: Record<string, unknown>
  serverFresh: Record<string, unknown>
}): { merged: Record<string, unknown>; conflictingKeys: string[] } {
  const merged: Record<string, unknown> = { ...args.serverFresh }
  const conflictingKeys: string[] = []
  for (const key of Object.keys(args.localDirty)) {
    const localValue = args.localDirty[key]
    const baseValue = args.baseSnapshot[key]
    const serverValue = args.serverFresh[key]
    const remoteChanged = !shallowEqual(baseValue, serverValue)
    if (remoteChanged && !shallowEqual(localValue, serverValue)) {
      conflictingKeys.push(key)
      merged[key] = localValue
      continue
    }
    merged[key] = localValue
  }
  return { merged, conflictingKeys }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!shallowEqual(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>)
    const bKeys = Object.keys(b as Record<string, unknown>)
    if (aKeys.length !== bKeys.length) return false
    for (const key of aKeys) {
      if (!shallowEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }
  return false
}
