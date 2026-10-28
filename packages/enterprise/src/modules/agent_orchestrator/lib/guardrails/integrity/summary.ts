import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentGuardrailCheck } from '../../../data/entities'
import { INTEGRITY_RULE_CHECK_KIND } from '../../../data/validators'

/**
 * The run API's integrity summary (spec `2026-10-21-output-integrity-guardrails`
 * → Observability and evals → Run API), derived purely from the run's persisted
 * `AgentGuardrailCheck` rows: one entry per integrity rule check (output phase,
 * an integrity kind and an evidence `ruleId`). Counts and reason-free fields
 * only — the evidence itself never leaves the trace endpoints.
 */
export const integrityOutcomeSchema = z.enum(['clean', 'repaired', 'flagged', 'not_applicable', 'needs_review'])
export type IntegrityOutcome = z.infer<typeof integrityOutcomeSchema>

export const integritySummaryCheckSchema = z.object({
  ruleId: z.string(),
  kind: z.string(),
  result: z.string(),
  dropped: z.number().int().nonnegative(),
  repaired: z.number().int().nonnegative(),
})
export type IntegritySummaryCheck = z.infer<typeof integritySummaryCheckSchema>

export const integritySummarySchema = z.object({
  outcome: integrityOutcomeSchema,
  checks: z.array(integritySummaryCheckSchema),
})
export type IntegritySummary = z.infer<typeof integritySummarySchema>

export type IntegrityCheckRow = {
  phase?: string | null
  kind?: string | null
  result?: string | null
  evidence?: unknown
}

const INTEGRITY_KINDS: ReadonlySet<string> = new Set(Object.values(INTEGRITY_RULE_CHECK_KIND))

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

/** The integrity rule id a check row's evidence names, or null for non-integrity checks. */
export function readCheckRuleId(evidence: unknown): string | null {
  const ruleId = evidenceRecord(evidence)?.ruleId
  return typeof ruleId === 'string' && ruleId.length > 0 ? ruleId : null
}

/** The pre-repair raw-output artifact key a check row's evidence points at, if any. */
export function readRawOutputKey(evidence: unknown): string | null {
  const rawOutput = evidenceRecord(evidence)?.rawOutput
  if (!rawOutput || typeof rawOutput !== 'object') return null
  const key = (rawOutput as Record<string, unknown>).key
  return typeof key === 'string' && key.length > 0 ? key : null
}

function isIntegrityCheck(row: IntegrityCheckRow): boolean {
  return row.phase === 'output' && typeof row.kind === 'string' && INTEGRITY_KINDS.has(row.kind)
}

/**
 * Precedence: a fired `needsReview` wins, then anything that blocks or holds
 * auto-approval (`flagged`), then an abstention (`not_applicable`), then quiet
 * drops/repairs (`repaired`); otherwise the output passed untouched (`clean`).
 * Null when the run recorded no integrity rule check (agents without `integrity`).
 */
export function buildIntegritySummary(rows: readonly IntegrityCheckRow[]): IntegritySummary | null {
  const checks: IntegritySummaryCheck[] = []
  let needsReview = false
  let flagged = false
  let notApplicable = false
  let changed = false
  for (const row of rows) {
    if (!isIntegrityCheck(row)) continue
    const evidence = evidenceRecord(row.evidence)
    const ruleId = readCheckRuleId(evidence)
    if (!ruleId) continue
    const dropped = countOf(evidence?.dropped)
    const repaired = countOf(evidence?.repaired)
    const result = typeof row.result === 'string' ? row.result : 'pass'
    checks.push({ ruleId, kind: row.kind as string, result, dropped, repaired })
    if (evidence?.outcome === 'needs_review') needsReview = true
    if (evidence?.outcome === 'not_applicable') notApplicable = true
    if (result === 'block' || evidence?.holdsAutoApproval === true) flagged = true
    if (dropped > 0 || repaired > 0) changed = true
  }
  if (checks.length === 0) return null
  const outcome: IntegrityOutcome = needsReview
    ? 'needs_review'
    : flagged
      ? 'flagged'
      : notApplicable
        ? 'not_applicable'
        : changed
          ? 'repaired'
          : 'clean'
  return { outcome, checks }
}

/** The first raw-output artifact key any of the run's checks references (null when the output was not changed). */
export function findRawOutputKey(rows: readonly IntegrityCheckRow[]): string | null {
  for (const row of rows) {
    const key = readRawOutputKey(row.evidence)
    if (key) return key
  }
  return null
}

export type RunIntegrityScope = { tenantId: string; organizationId: string | null }

/** Loads a run's check rows (tenant + organization scoped) and derives its integrity summary. */
export async function loadRunIntegritySummary(
  em: EntityManager,
  runId: string,
  scope: RunIntegrityScope,
): Promise<IntegritySummary | null> {
  const rows = await em.find(
    AgentGuardrailCheck,
    { agentRunId: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { createdAt: 'asc' }, fields: ['phase', 'kind', 'result', 'evidence'] },
  )
  return buildIntegritySummary(rows)
}
