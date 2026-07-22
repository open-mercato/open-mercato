import {
  extractOptimisticLockConflict,
  extractRecordLockConflict,
  type RecordLockConflictBody,
} from '../utils/optimisticLock'
import { showRecordConflict } from './store'

export {
  showRecordConflict,
  dismissRecordConflict,
  useRecordConflict,
  getRecordConflictForTest,
  type RecordConflictEntry,
  type ShowRecordConflictInput,
} from './store'
export { RecordConflictBanner } from './RecordConflictBanner'

type Translate = (key: string, fallback?: string) => string

export type SurfaceRecordConflictOptions = {
  /** Custom refresh handler. Omit to let the banner reload the page. */
  onRefresh?: (() => void) | null
  /** Localized title override; the banner falls back to a generic title. */
  title?: string | null
}

/**
 * Handler the enterprise `record_locks` merge-dialog widget registers (on mount)
 * so `surfaceRecordConflict` can defer the OSS conflict bar in favor of the
 * field-level merge dialog. Core/UI stays enterprise-free: enterprise calls
 * {@link registerRecordLockConflictHandler}; this module never imports it.
 *
 * MUST return `true` only when it actually owns/renders the surface for THIS
 * conflict (its widget is mounted for the conflicting record). Returning `false`
 * (different record / cannot render) makes `surfaceRecordConflict` fall through
 * to the OSS conflict bar, so a conflict is never swallowed and we never render
 * BOTH the merge dialog and the bar (single surface, S3).
 */
export type RecordLockConflictHandler = (conflict: RecordLockConflictBody, error: unknown) => boolean

let recordLockConflictHandler: RecordLockConflictHandler | null = null

/**
 * Register the record-lock conflict handler (enterprise merge-dialog widget).
 * Returns an unregister function. When a handler is registered,
 * `surfaceRecordConflict` defers `record_lock_conflict` 409s to it instead of
 * rendering the OSS conflict bar (single surface, S3).
 *
 * SAFETY: when NO handler is registered (widget absent/removed),
 * `surfaceRecordConflict` still renders the OSS conflict bar for ANY 409 — a
 * conflict is never silently swallowed.
 */
export function registerRecordLockConflictHandler(handler: RecordLockConflictHandler): () => void {
  recordLockConflictHandler = handler
  return () => {
    if (recordLockConflictHandler === handler) recordLockConflictHandler = null
  }
}

/** Test-only: inspect whether a record-lock conflict handler is registered. */
export function hasRecordLockConflictHandlerForTest(): boolean {
  return recordLockConflictHandler !== null
}

/** Test-only: clear any registered record-lock conflict handler. */
export function resetRecordLockConflictHandlerForTest(): void {
  recordLockConflictHandler = null
}

/**
 * Single conflict surface (S3). Resolves a 409 to exactly one UI:
 *
 *   - `record_lock_conflict` payload AND a merge-dialog handler registered →
 *     defer to the handler (no conflict bar) and return `true`.
 *   - otherwise (OSS `optimistic_lock_conflict`, OR a `record_lock_conflict`
 *     with NO handler registered) → render the OSS conflict bar and return
 *     `true`. A conflict is ALWAYS surfaced; the worst case is plainer UX, never
 *     a silently-swallowed conflict.
 *   - not a recognized conflict → return `false` so callers fall back to their
 *     normal error handling.
 */
export function surfaceRecordConflict(
  error: unknown,
  t: Translate,
  options: SurfaceRecordConflictOptions = {},
): boolean {
  const recordLockConflict = extractRecordLockConflict(error)
  if (recordLockConflict && recordLockConflictHandler) {
    // The widget owns the surface ONLY when it handles this record's conflict
    // (returns true). If it declines (different record / not mounted for it),
    // fall through to the OSS bar so the conflict is never swallowed and we
    // never render both the merge dialog AND the bar.
    if (recordLockConflictHandler(recordLockConflict, error)) return true
  }

  const ossConflict = extractOptimisticLockConflict(error)
  if (ossConflict) {
    showRecordConflict({
      message: t(
        'ui.forms.flash.recordModified',
        'This record was modified by someone else. Refresh and try again.',
      ),
      title: options.title ?? null,
      currentUpdatedAt: ossConflict.currentUpdatedAt,
      onRefresh: options.onRefresh ?? null,
    })
    return true
  }

  // No handler is registered but the server returned a record-lock 409: still
  // render the OSS bar so the conflict is never swallowed.
  if (recordLockConflict) {
    showRecordConflict({
      message: t(
        'ui.forms.flash.recordModified',
        'This record was modified by someone else. Refresh and try again.',
      ),
      title: options.title ?? null,
      currentUpdatedAt: null,
      onRefresh: options.onRefresh ?? null,
    })
    return true
  }

  return false
}
