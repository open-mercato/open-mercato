/**
 * Client-side helpers for the OSS opt-in optimistic-locking guard
 * (spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md).
 *
 * These are deliberately small and dependency-light so they can be wired
 * into any backend page without touching the shared CrudForm / useGuardedMutation
 * components. A future PR may pull them into CrudForm directly once the
 * reference rollout is broader.
 */
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
  type OptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * Build the extension-header bag for an `apiCall` request. Pass into
 * `withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), ...)`
 * when issuing a `PUT`/`PATCH`/`DELETE` for a record that exposes
 * `updatedAt`. Returns an empty object when the input is missing/empty so
 * the call site stays unconditional:
 *
 * ```ts
 * await withScopedApiRequestHeaders(
 *   buildOptimisticLockHeader(record.updatedAt),
 *   () => updateCrud('customers/companies', id, { ... }),
 * )
 * ```
 */
export function buildOptimisticLockHeader(
  updatedAt: string | null | undefined,
): Record<string, string> {
  if (typeof updatedAt !== 'string') return {}
  const trimmed = updatedAt.trim()
  if (!trimmed) return {}
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: trimmed }
}

/**
 * Detect whether an error thrown by `raiseCrudError`/`apiCallOrThrow` is an
 * optimistic-lock conflict (HTTP 409 with `code: 'optimistic_lock_conflict'`).
 *
 * Returns the typed conflict body when matched so the caller can show a
 * UI that includes the server's `currentUpdatedAt`, or `null` otherwise.
 */
export function extractOptimisticLockConflict(
  err: unknown,
): OptimisticLockConflictBody | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as Record<string, unknown>
  const status = candidate.status
  if (status !== 409) return null
  const body = candidate.body && typeof candidate.body === 'object'
    ? candidate.body
    : candidate
  if (!body || typeof body !== 'object') return null
  const bodyRecord = body as Record<string, unknown>
  if (bodyRecord.code !== OPTIMISTIC_LOCK_CONFLICT_CODE) return null
  const currentUpdatedAt = bodyRecord.currentUpdatedAt
  const expectedUpdatedAt = bodyRecord.expectedUpdatedAt
  if (typeof currentUpdatedAt !== 'string' || typeof expectedUpdatedAt !== 'string') return null
  return {
    error: typeof bodyRecord.error === 'string'
      ? (bodyRecord.error as OptimisticLockConflictBody['error'])
      : 'record_modified',
    code: OPTIMISTIC_LOCK_CONFLICT_CODE,
    currentUpdatedAt,
    expectedUpdatedAt,
  }
}

/**
 * The enterprise `record_locks` 409 conflict code. Kept as a literal here so
 * core/UI stays enterprise-free (no import from `@open-mercato/enterprise`).
 */
export const RECORD_LOCK_CONFLICT_CODE = 'record_lock_conflict' as const

export type RecordLockConflictBody = {
  code: typeof RECORD_LOCK_CONFLICT_CODE
  error?: string
  lock?: unknown
  conflict?: unknown
}

/**
 * Detect whether an error is an enterprise `record_locks` conflict (HTTP 409
 * with `code: 'record_lock_conflict'`). Returns the conflict body when matched
 * so `surfaceRecordConflict` can defer to the merge-dialog widget, or `null`.
 */
export function extractRecordLockConflict(err: unknown): RecordLockConflictBody | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as Record<string, unknown>
  if (candidate.status !== 409) return null
  const body = candidate.body && typeof candidate.body === 'object'
    ? candidate.body
    : candidate
  if (!body || typeof body !== 'object') return null
  const bodyRecord = body as Record<string, unknown>
  if (bodyRecord.code !== RECORD_LOCK_CONFLICT_CODE) return null
  return {
    code: RECORD_LOCK_CONFLICT_CODE,
    error: typeof bodyRecord.error === 'string' ? bodyRecord.error : undefined,
    lock: bodyRecord.lock ?? null,
    conflict: bodyRecord.conflict ?? null,
  }
}
