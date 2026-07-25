import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'

/**
 * True when `error` is an OSS optimistic-lock-floor conflict — an HTTP 409 whose
 * body carries `code: 'optimistic_lock_conflict'`, the shape every standard
 * `makeCrudRoute` route raises on a stale `CrudForm` save.
 *
 * Such a conflict is already surfaced by the shared OSS conflict bar
 * (`surfaceRecordConflict` / `record-conflict-banner`). The enterprise record-lock
 * widget consults this predicate so it can stand down for those 409s instead of
 * opening a second, degraded merge dialog — preserving the single-conflict-surface
 * invariant S3 (issue #3504). The merge dialog stays reserved for genuine
 * `record_lock_conflict` 409s.
 *
 * Reusing the canonical OSS detector keeps this decision identical to the one the
 * conflict bar makes, so the two surfaces can never disagree about ownership.
 */
export function isOptimisticLockFloorConflict(error: unknown): boolean {
  return extractOptimisticLockConflict(error) !== null
}

/**
 * What the record-lock widget should do with a save error that produced **no**
 * `record_lock_conflict` payload (`extractRecordLockConflictPayload` returned null):
 *
 * - `defer-to-conflict-bar` — an OSS optimistic-lock-floor 409 the shared conflict
 *   bar already owns; the widget must NOT open a merge dialog (#3504 / S3).
 * - `fallback-merge-dialog` — a different 409; synthesize the fallback merge dialog
 *   (prior behavior, unchanged).
 * - `ignore` — not a 409; nothing for this widget to surface.
 */
export type UnmatchedSaveErrorOutcome =
  | 'defer-to-conflict-bar'
  | 'fallback-merge-dialog'
  | 'ignore'

/**
 * Pure decision for the no-payload branch of the widget's `onCrudSaveError`
 * listener. Extracted so the #3504 arbitration — deferring optimistic-lock-floor
 * 409s to the shared conflict bar — is unit-testable without rendering the client
 * widget. `status` is the value the listener already computed via its own
 * `extractErrorStatus`, so the 409 gate stays consistent with the rest of the
 * listener.
 */
export function classifyUnmatchedSaveError(
  error: unknown,
  status: number | null,
): UnmatchedSaveErrorOutcome {
  if (status !== 409) return 'ignore'
  return isOptimisticLockFloorConflict(error) ? 'defer-to-conflict-bar' : 'fallback-merge-dialog'
}
