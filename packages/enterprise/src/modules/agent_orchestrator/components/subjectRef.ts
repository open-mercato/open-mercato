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
