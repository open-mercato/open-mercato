/**
 * Shared best-effort subject-reference probe for run/proposal inputs.
 *
 * Cockpit pages label rows with "the thing this run is about" when the agent
 * input carries a recognizable reference. The probe list is a heuristic over
 * common id-shaped keys (domain-specific ones kept for compatibility with
 * existing agents) — full replacement by declared agent facts is tracked as a
 * follow-up of the 2026-07-12 consistency pass.
 */
const SUBJECT_REF_KEYS = [
  'claimId',
  'claim_id',
  'dealId',
  'deal_id',
  'reference',
  'subjectId',
  'subject_id',
  'ref',
] as const

export function subjectRefOf(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  for (const key of SUBJECT_REF_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/** Characters of the identifier a short case id keeps. */
const SHORT_CASE_ID_LENGTH = 8

/**
 * The module's one short case-id rendering: the leading hex block of a record
 * id, upper-cased.
 *
 * It exists because `subjectRefOf` legitimately finds nothing — an agent whose
 * input carries no recognizable reference has no subject to name, and no later
 * fetch will produce one. The fallback is therefore permanent, not a loading
 * state, so it has to be readable on its own.
 *
 * Eight characters is the boundary the processes list already searches on
 * (`components/processTypes.ts`), which is what makes this a case REFERENCE an
 * operator can paste into a search box rather than a truncated UUID: a UUID's
 * first block is exactly eight hex digits, so the cut never lands mid-group and
 * never leaves a dangling `-`.
 */
export function shortCaseId(id: string | null | undefined): string {
  const trimmed = (id ?? '').trim()
  if (!trimmed) return ''
  return trimmed.slice(0, SHORT_CASE_ID_LENGTH).toUpperCase()
}

/**
 * What a row shows in its "subject" slot: the reference the agent input
 * declared, or the short case id of the record it belongs to.
 */
export function subjectLabelOf(input: unknown, fallbackId: string | null | undefined): string {
  return subjectRefOf(input) ?? shortCaseId(fallbackId)
}
