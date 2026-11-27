/**
 * Client-side reading of the redacted guardrail evidence an integrity check row
 * carries (spec `2026-10-21-output-integrity-guardrails` → Observability): the
 * rule id, whether the warn holds auto-approval, the drop/repair counts and the
 * raw-output pointer status. Pure and dependency-free so the trace inspector and
 * the Caseload read one implementation; the evidence content itself is never
 * interpreted beyond these fields.
 */
export type RawOutputStatus = 'stored' | 'storage_unavailable'

export type GuardEvidenceFlags = {
  ruleId: string | null
  holdsAutoApproval: boolean
  dropped: number
  repaired: number
  rawOutputStatus: RawOutputStatus | null
}

function evidenceRecord(evidence: unknown): Record<string, unknown> | null {
  if (typeof evidence === 'string') {
    try {
      return evidenceRecord(JSON.parse(evidence))
    } catch {
      return null
    }
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null
  return evidence as Record<string, unknown>
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function rawOutputStatusOf(value: unknown): RawOutputStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const status = (value as Record<string, unknown>).status
  return status === 'stored' || status === 'storage_unavailable' ? status : null
}

export function readGuardEvidence(evidence: unknown): GuardEvidenceFlags {
  const record = evidenceRecord(evidence)
  const ruleId = record?.ruleId
  return {
    ruleId: typeof ruleId === 'string' && ruleId.length > 0 ? ruleId : null,
    holdsAutoApproval: record?.holdsAutoApproval === true,
    dropped: countOf(record?.dropped),
    repaired: countOf(record?.repaired),
    rawOutputStatus: rawOutputStatusOf(record?.rawOutput),
  }
}

export function guardrailKindLabelKey(kind: string): string {
  return `agent_orchestrator.traces.detail.guardrailKind.${kind}`
}

export type HoldingCheck = {
  result: string
  ruleId: string | null
  holdsAutoApproval: boolean
}

/**
 * The integrity rule ids that held a proposal back from auto-approval: rules
 * that blocked, or warned with `holdsAutoApproval`. Unique, in check order.
 * Legacy warns (no rule id, or no hold flag) never count.
 */
export function heldIntegrityRuleIds(checks: ReadonlyArray<HoldingCheck>): string[] {
  const ids: string[] = []
  for (const check of checks) {
    if (!check.ruleId) continue
    const holds = check.result === 'block' || (check.result === 'warn' && check.holdsAutoApproval)
    if (holds && !ids.includes(check.ruleId)) ids.push(check.ruleId)
  }
  return ids
}
