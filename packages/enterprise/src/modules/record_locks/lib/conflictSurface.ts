import { extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'

/**
 * True when `error` is an OSS optimistic-lock conflict (HTTP 409 with
 * `code: 'optimistic_lock_conflict'`) — the conflict shape the shared OSS
 * conflict bar (`surfaceRecordConflict`) already owns on the standard
 * `makeCrudRoute` / `CrudForm` save path.
 *
 * The record-lock widget consults this before opening its fallback merge
 * dialog: it must defer to the OSS bar for these 409s rather than render a
 * second, degraded conflict surface, which would violate the single-surface
 * invariant (issue #3504 / S3). The merge dialog stays reserved for genuine
 * `record_lock_conflict` 409s.
 */
export function isOssOptimisticLockConflict(error: unknown): boolean {
  return extractOptimisticLockConflict(error) !== null
}

/**
 * Surface the record-lock widget's `onCrudSaveError` listener should drive for a
 * given save error:
 * - `ignore` — not relevant to this widget instance (wrong form, no record
 *   identity, or a non-conflict error).
 * - `record-deleted` — the record was deleted underneath the editor.
 * - `open-fallback-dialog` — open the merge dialog with a synthesized conflict.
 * - `defer-to-oss-conflict-bar` — an OSS optimistic-lock 409 the shared conflict
 *   bar already owns; the widget must NOT open a second surface (#3504 / S3).
 * - `apply-record-lock-payload` — a genuine `record_lock_conflict` payload to render.
 */
export type CrudSaveErrorSurfaceAction =
  | 'ignore'
  | 'record-deleted'
  | 'open-fallback-dialog'
  | 'defer-to-oss-conflict-bar'
  | 'apply-record-lock-payload'

export type CrudSaveErrorDecisionInput = {
  error: unknown
  eventTargetsCurrentForm: boolean
  hasRecordLockPayload: boolean
  payloadResourceKind?: string | null
  payloadResourceId?: string | null
  currentResourceKind?: string | null
  currentResourceId?: string | null
  isRecordDeleted: boolean
  errorStatus: number | null
}

/**
 * Pure decision for the record-lock widget's `onCrudSaveError` listener. Extracted
 * from `widget.client.tsx` so the surface-arbitration wiring is unit-testable
 * without rendering the client component — in particular the #3504 invariant that
 * an OSS optimistic-lock 409 defers to the shared conflict bar instead of opening
 * a second, degraded merge dialog.
 */
export function decideCrudSaveErrorAction(
  input: CrudSaveErrorDecisionInput,
): CrudSaveErrorSurfaceAction {
  const hasCurrentIdentity = Boolean(input.currentResourceKind) && Boolean(input.currentResourceId)

  if (!input.eventTargetsCurrentForm) {
    if (!input.hasRecordLockPayload || !hasCurrentIdentity) return 'ignore'
    const payloadResourceKind = (input.payloadResourceKind ?? '').trim()
    const payloadResourceId = (input.payloadResourceId ?? '').trim()
    if (!payloadResourceKind || !payloadResourceId) return 'ignore'
    if (payloadResourceKind !== input.currentResourceKind || payloadResourceId !== input.currentResourceId) {
      return 'ignore'
    }
  }

  if (!input.hasRecordLockPayload) {
    if (!hasCurrentIdentity) return 'ignore'
    if (input.isRecordDeleted) return 'record-deleted'
    if (input.errorStatus === 409) {
      return isOssOptimisticLockConflict(input.error)
        ? 'defer-to-oss-conflict-bar'
        : 'open-fallback-dialog'
    }
    return 'ignore'
  }

  return 'apply-record-lock-payload'
}
