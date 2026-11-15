/**
 * Report numbering — the `RAP-2026-0042` printed on the sheet header of screen 14.
 *
 * The number is a billing document identifier: it is quoted on a PDF a client
 * keeps, so it is allocated once, frozen, and **never reused**. Two consequences
 * follow and are both enforced here:
 *
 *  1. **The highest number ever handed out wins, deleted reports included.** The
 *     unique index only covers live rows, so a soft-deleted `RAP-2026-0042` would
 *     otherwise let the next report take that number — and the client holding the
 *     first PDF would find a different report behind it.
 *  2. **Allocation races are settled by the database, not by a pre-read.** Reading
 *     `MAX(sequence)` up front only narrows the window; two people generating a
 *     report at the same moment would still both compute `0042`. The partial
 *     unique index on `(organization_id, tenant_id, reference) WHERE deleted_at IS
 *     NULL` makes the loser's insert fail, and the loser retries the whole
 *     transaction against a max that now includes the winner's row. This is the
 *     same shape `lib/timesheets-tasks/taskReference.ts` uses for `TT-142`.
 *
 * The year in the reference is the year the report is **issued**, not the year its
 * period covers: a report generated in January for December's work is a January
 * document, and its sequence belongs to the new year's run. The sheet prints the
 * issue date beside the reference, so the two always agree.
 */

import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'

export const REPORT_REFERENCE_PREFIX = 'RAP'

export const FIRST_REPORT_SEQUENCE_NUMBER = 1

/** Width of the zero-padded run, matching the mockup's `RAP-2026-0042`. */
export const REPORT_SEQUENCE_PAD = 4

/**
 * Attempts before the conflict is surfaced. Each retry costs one aborted
 * transaction; an organization would need this many simultaneous generations
 * landing on the same number for the last one to give up.
 */
export const REPORT_REFERENCE_MAX_ATTEMPTS = 5

export type ReportReferenceAllocation = {
  sequenceNumber: number
  reference: string
}

export function reportReferenceYear(issuedAt: Date | null | undefined): number {
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) {
    return new Date().getFullYear()
  }
  return issuedAt.getFullYear()
}

export function reportReferencePrefix(year: number): string {
  return `${REPORT_REFERENCE_PREFIX}-${year}-`
}

export function formatReportReference(year: number, sequenceNumber: number): string {
  const padded = String(Math.max(FIRST_REPORT_SEQUENCE_NUMBER, sequenceNumber)).padStart(
    REPORT_SEQUENCE_PAD,
    '0',
  )
  return `${reportReferencePrefix(year)}${padded}`
}

/**
 * Reads the run number back out of a stored reference. Returns `null` for
 * anything that is not this year's series, so a hand-edited or legacy reference
 * can never inflate the next allocation.
 */
export function parseReportSequenceNumber(reference: unknown, year: number): number | null {
  if (typeof reference !== 'string') return null
  const prefix = reportReferencePrefix(year)
  if (!reference.startsWith(prefix)) return null
  const tail = reference.slice(prefix.length)
  if (!/^\d+$/.test(tail)) return null
  const parsed = Number.parseInt(tail, 10)
  if (!Number.isFinite(parsed) || parsed < FIRST_REPORT_SEQUENCE_NUMBER) return null
  return parsed
}

export function highestReportSequenceNumber(references: readonly unknown[], year: number): number {
  let highest = 0
  for (const reference of references) {
    const parsed = parseReportSequenceNumber(reference, year)
    if (parsed !== null && parsed > highest) highest = parsed
  }
  return highest
}

export function nextReportSequenceNumber(highestSequenceNumber: number | null | undefined): number {
  if (typeof highestSequenceNumber !== 'number' || !Number.isFinite(highestSequenceNumber)) {
    return FIRST_REPORT_SEQUENCE_NUMBER
  }
  const next = Math.floor(highestSequenceNumber) + 1
  return next < FIRST_REPORT_SEQUENCE_NUMBER ? FIRST_REPORT_SEQUENCE_NUMBER : next
}

/**
 * The candidate one attempt writes. A plain function of what that attempt read
 * inside its own transaction, so nothing is carried between attempts.
 */
export function allocateReportReference(
  year: number,
  highestSequenceNumber: number | null | undefined,
): ReportReferenceAllocation {
  const sequenceNumber = nextReportSequenceNumber(highestSequenceNumber)
  return { sequenceNumber, reference: formatReportReference(year, sequenceNumber) }
}

export function isReportReferenceConflict(err: unknown): boolean {
  return isUniqueViolation(err)
}

export type ReportReferenceRetryOptions = {
  maxAttempts?: number
  isConflict?: (err: unknown) => boolean
}

/**
 * Runs the create attempt until it wins the number or the budget runs out.
 *
 * `runAttempt` MUST re-read the organization's highest reference inside its own
 * transaction — that is the whole point of retrying rather than pre-reading. A
 * non-conflict error is rethrown immediately: only a lost race is worth
 * repeating.
 */
export async function withReportReferenceRetry<T>(
  runAttempt: (attempt: number) => Promise<T>,
  options: ReportReferenceRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? REPORT_REFERENCE_MAX_ATTEMPTS)
  const isConflict = options.isConflict ?? isReportReferenceConflict
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
