/**
 * Global registry of OSS optimistic-lock readers keyed by `resourceKind`.
 *
 * Multiple modules can contribute readers without conflicting on the
 * single Awilix `crudMutationGuardService` slot: each module calls
 * `registerOptimisticLockReaders({...})` from its `di.ts` at module-load
 * time, and any one of them can register the
 * `crudMutationGuardService` Awilix binding (Awilix replaces same-key
 * registrations, so the *last loaded* wins — but every binding points
 * to the same store-backed factory, so the resulting guard set is
 * identical regardless of order).
 *
 * Mirrors the `mutation-guard-store.ts` HMR-safe globalThis pattern.
 *
 * Spec: .ai/specs/2026-05-25-oss-optimistic-locking.md
 */
import type { OptimisticLockCurrentReader } from './optimistic-lock'

const GLOBAL_KEY = '__openMercatoOptimisticLockReaders__'

function readGlobal(): Record<string, OptimisticLockCurrentReader> {
  try {
    const value = (globalThis as Record<string, unknown>)[GLOBAL_KEY]
    if (value && typeof value === 'object') {
      return value as Record<string, OptimisticLockCurrentReader>
    }
    return {}
  } catch {
    return {}
  }
}

function writeGlobal(value: Record<string, OptimisticLockCurrentReader>): void {
  try {
    ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = value
  } catch {
    // ignore global assignment failures in restricted runtimes
  }
}

/**
 * Register optimistic-lock readers for one or more `resourceKind` values.
 * Idempotent for same-key calls (later registration overrides earlier).
 */
export function registerOptimisticLockReaders(
  readers: Record<string, OptimisticLockCurrentReader>,
): void {
  const existing = readGlobal()
  writeGlobal({ ...existing, ...readers })
}

/**
 * Register optimistic-lock readers only for keys that have no reader yet.
 * Use this for fallback / generic registrations (e.g. the auto-registration
 * driven by `makeCrudRoute`) so module-level hand-wired readers — which
 * register first via `di.ts` — always win.
 *
 * Returns the set of keys that were actually written, which makes the helper
 * easy to assert on in tests and useful for diagnostics in callers.
 */
export function registerOptimisticLockReaderIfAbsent(
  readers: Record<string, OptimisticLockCurrentReader>,
): string[] {
  const existing = readGlobal()
  const next: Record<string, OptimisticLockCurrentReader> = { ...existing }
  const written: string[] = []
  for (const [key, reader] of Object.entries(readers)) {
    if (!(key in existing)) {
      next[key] = reader
      written.push(key)
    }
  }
  if (written.length > 0) writeGlobal(next)
  return written
}

export function getAllOptimisticLockReaders(): Record<string, OptimisticLockCurrentReader> {
  return readGlobal()
}

export function clearOptimisticLockReadersForTests(): void {
  try {
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY]
  } catch {
    // ignore
  }
}
