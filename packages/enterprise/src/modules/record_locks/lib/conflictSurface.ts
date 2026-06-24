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
