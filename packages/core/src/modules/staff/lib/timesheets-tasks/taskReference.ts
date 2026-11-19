/**
 * Per-project task numbering — the `TT-142` on the card, the drawer title and every
 * report line that names a task.
 *
 * The reference is denormalized (`<project.code>-<sequence_number>`) because it is
 * quoted in places the task row is no longer joined: a closed report keeps its line
 * labels after the task is gone, and a client-facing sheet must keep showing the same
 * number it showed last month. Renaming the project's code therefore does not
 * retro-number existing tasks — the reference is allocated once and frozen.
 *
 * Allocation is the interesting part. Two people creating a task in the same project
 * at the same moment must not both get `TT-142`, and reading `MAX(sequence_number)`
 * up front does not prevent that — it only narrows the window. The database is the
 * arbiter instead: the partial unique index on
 * `(organization_id, tenant_id, time_project_id, sequence_number) WHERE deleted_at IS NULL`
 * makes the loser's insert fail, and the loser retries the whole transaction, reading
 * a max that now includes the winner's row. A gap left by a rolled-back attempt is
 * cosmetic and deliberately not reclaimed (spec risk R6).
 */

import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'

/** Used when a project somehow has no usable code, so a task can still be numbered. */
export const TASK_REFERENCE_FALLBACK_CODE = 'TASK'

export const FIRST_TASK_SEQUENCE_NUMBER = 1

/**
 * Attempts before the conflict is surfaced to the caller. Each retry costs one
 * aborted transaction, and a project would need this many simultaneous creates
 * landing on the same number for the last one to give up.
 */
export const TASK_REFERENCE_MAX_ATTEMPTS = 5

export type TaskReferenceAllocation = {
  sequenceNumber: number
  reference: string
}

export function normalizeProjectCodeForReference(code: string | null | undefined): string {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  return trimmed.length > 0 ? trimmed : TASK_REFERENCE_FALLBACK_CODE
}

export function nextTaskSequenceNumber(highestSequenceNumber: number | null | undefined): number {
  if (typeof highestSequenceNumber !== 'number' || !Number.isFinite(highestSequenceNumber)) {
    return FIRST_TASK_SEQUENCE_NUMBER
  }
  const next = Math.floor(highestSequenceNumber) + 1
  return next < FIRST_TASK_SEQUENCE_NUMBER ? FIRST_TASK_SEQUENCE_NUMBER : next
}

export function formatTaskReference(code: string | null | undefined, sequenceNumber: number): string {
  return `${normalizeProjectCodeForReference(code)}-${sequenceNumber}`
}

/**
 * The candidate one attempt writes. It is a plain function of what that attempt read
 * inside its own transaction, so nothing is carried between attempts.
 */
export function allocateTaskReference(
  code: string | null | undefined,
  highestSequenceNumber: number | null | undefined,
): TaskReferenceAllocation {
  const sequenceNumber = nextTaskSequenceNumber(highestSequenceNumber)
  return { sequenceNumber, reference: formatTaskReference(code, sequenceNumber) }
}

/**
 * A losing race shows up as a unique violation on either of the task's two partial
 * indexes — the `(project, sequence_number)` pair or the denormalized `reference`.
 * Both mean the same thing here: someone else took this number, take the next one.
 */
export function isTaskReferenceConflict(err: unknown): boolean {
  return isUniqueViolation(err)
}

export type TaskReferenceRetryOptions = {
  maxAttempts?: number
  isConflict?: (err: unknown) => boolean
}

/**
 * Runs the create attempt until it wins the number or the budget runs out.
 *
 * `runAttempt` MUST re-read the project's highest sequence number inside its own
 * transaction — that is the whole point of retrying rather than pre-reading. A
 * non-conflict error is rethrown immediately: only a lost race is worth repeating.
 */
export async function withTaskReferenceRetry<T>(
  runAttempt: (attempt: number) => Promise<T>,
  options: TaskReferenceRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? TASK_REFERENCE_MAX_ATTEMPTS)
  const isConflict = options.isConflict ?? isTaskReferenceConflict
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await runAttempt(attempt)
    } catch (err) {
      if (!isConflict(err)) throw err
      lastError = err
    }
  }

  throw lastError
}
