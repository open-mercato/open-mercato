/**
 * Single source of truth for the operator-triggered history-import bounds.
 *
 * Defaults are the values a request gets when it omits the field; ceilings are
 * the largest value the hub accepts. Ceilings are deliberately wide enough for
 * a multi-year backfill and can be raised or lowered per deployment through
 * `OM_IMPORT_HISTORY_MAX_SINCE_DAYS` / `OM_IMPORT_HISTORY_MAX_MESSAGES`.
 *
 * Env is read at call time (not module load) so a deployment can change the
 * ceiling without a rebuild, and so tests can exercise the override. In the
 * browser bundle the variables are absent and the built-in ceilings apply —
 * client-side validation is a UX affordance, the API remains the authority.
 */

export const IMPORT_HISTORY_DEFAULT_SINCE_DAYS = 30
export const IMPORT_HISTORY_DEFAULT_MAX_MESSAGES = 1000

export const IMPORT_HISTORY_MAX_SINCE_DAYS_FALLBACK = 3650
export const IMPORT_HISTORY_MAX_MESSAGES_FALLBACK = 50000

export const IMPORT_HISTORY_MAX_CONTACT_EMAILS = 200

export const IMPORT_HISTORY_MIN_PAGE_BUDGET = 100
export const IMPORT_HISTORY_ABSOLUTE_MAX_PAGES = 10000

/**
 * Consecutive pages that may return no messages while the adapter still claims
 * `hasMore` and advances its cursor. Empty pages are legitimate: the Gmail
 * adapter drops messages that returned 404/410 between listing and fetching,
 * and server-side filters can eliminate a whole page. A stuck adapter is caught
 * by the repeated-cursor check, so this counter only has to bound the run when
 * the cursor keeps moving but nothing is ever returned.
 */
export const IMPORT_HISTORY_MAX_EMPTY_PAGES = 10

export const IMPORT_HISTORY_MAX_SINCE_DAYS_ENV = 'OM_IMPORT_HISTORY_MAX_SINCE_DAYS'
export const IMPORT_HISTORY_MAX_MESSAGES_ENV = 'OM_IMPORT_HISTORY_MAX_MESSAGES'

export type ImportHistoryLimits = {
  defaultSinceDays: number
  defaultMaxMessages: number
  maxSinceDays: number
  maxMessages: number
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getImportHistoryMaxSinceDays(): number {
  return Math.max(
    IMPORT_HISTORY_DEFAULT_SINCE_DAYS,
    readPositiveIntEnv(IMPORT_HISTORY_MAX_SINCE_DAYS_ENV, IMPORT_HISTORY_MAX_SINCE_DAYS_FALLBACK),
  )
}

export function getImportHistoryMaxMessages(): number {
  return Math.max(
    IMPORT_HISTORY_DEFAULT_MAX_MESSAGES,
    readPositiveIntEnv(IMPORT_HISTORY_MAX_MESSAGES_ENV, IMPORT_HISTORY_MAX_MESSAGES_FALLBACK),
  )
}

export function getImportHistoryLimits(): ImportHistoryLimits {
  return {
    defaultSinceDays: IMPORT_HISTORY_DEFAULT_SINCE_DAYS,
    defaultMaxMessages: IMPORT_HISTORY_DEFAULT_MAX_MESSAGES,
    maxSinceDays: getImportHistoryMaxSinceDays(),
    maxMessages: getImportHistoryMaxMessages(),
  }
}

/**
 * Page budget for the import drain loop, derived from the effective message cap
 * so a large import is never truncated before it reaches that cap. It is only a
 * backstop: an adapter that never makes progress is stopped much earlier by the
 * consecutive-empty-page guard.
 */
export function resolveImportHistoryPageBudget(maxMessages: number): number {
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) return IMPORT_HISTORY_MIN_PAGE_BUDGET
  return Math.min(
    IMPORT_HISTORY_ABSOLUTE_MAX_PAGES,
    Math.max(IMPORT_HISTORY_MIN_PAGE_BUDGET, Math.ceil(maxMessages)),
  )
}
