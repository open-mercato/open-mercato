import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

/**
 * View models and status mappings for the evaluation-run cockpit pages
 * (`backend/eval-runs`). The API speaks snake_case; every page reads these
 * mappers instead of touching raw payload keys, so a contract change lands in
 * one place.
 */

export type EvalSuiteStatusState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type EvalSuiteOutcomeState = 'passed' | 'failed' | 'advisory'
export type EvalSuiteTriggerState = 'manual' | 'ci' | 'scheduled'
export type EvalCaseRunStatusState = 'pending' | 'running' | 'passed' | 'failed' | 'error' | 'skipped'
export type EvalSeverityState = 'gate' | 'warn'

/**
 * A verdict is THREE-valued. `null` means the assertion or case run was
 * SKIPPED — neither a pass nor a failure, and excluded from aggregation — so it
 * must never render through the failure branch.
 */
export type EvalVerdictState = 'passed' | 'failed' | 'skipped'

export type EvalRunRow = {
  id: string
  agentDefinitionId: string
  trigger: EvalSuiteTriggerState
  status: EvalSuiteStatusState
  outcome: EvalSuiteOutcomeState | null
  caseCount: number
  errorCount: number
  passScore: number | null
  scoreVariance: number | null
  repeatCount: number
  judgeMayGate: boolean
  triggeredBy: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string | null
}

export type EvalRunDetailView = EvalRunRow & {
  releaseId: string | null
  evalSetVersion: string | null
  /** Assertion keys that regressed against the baseline. Non-empty blocks a gate. */
  safetyRegressions: string[]
  summary: unknown
}

export type EvalCaseRunRow = {
  id: string
  evalCaseId: string
  agentRunId: string | null
  trialIndex: number
  status: EvalCaseRunStatusState
  passed: boolean | null
  score: number | null
  latencyMs: number | null
  costMinor: number | null
  errorMessage: string | null
  createdAt: string | null
}

/**
 * The golden record a case run was scored against. Read per expanded case run
 * from `/api/agent_orchestrator/eval-cases/:id` — the only route that returns a
 * case payload, since `input`/`expected` are encrypted at rest and the list
 * projection deliberately omits them.
 */
export type EvalCaseView = {
  id: string
  status: string
  sourceType: string
  processType: string | null
  input: unknown
  expected: unknown
  updatedAt: string | null
}

/** One diverging path from a `json_match` result, with both sides. */
export type EvalMismatchRow = {
  path: string
  expected: unknown
  actual: unknown
}

export type EvalAssertionResultRow = {
  id: string
  assertionId: string
  assertionKey: string
  passed: boolean | null
  score: number | null
  severity: EvalSeverityState
  evidence: unknown
  evaluatedAt: string | null
}

const SUITE_STATUSES: EvalSuiteStatusState[] = ['queued', 'running', 'completed', 'failed', 'cancelled']
const SUITE_OUTCOMES: EvalSuiteOutcomeState[] = ['passed', 'failed', 'advisory']
const SUITE_TRIGGERS: EvalSuiteTriggerState[] = ['manual', 'ci', 'scheduled']
const CASE_RUN_STATUSES: EvalCaseRunStatusState[] = ['pending', 'running', 'passed', 'failed', 'error', 'skipped']

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function readUnion<T extends string>(record: Record<string, unknown>, key: string, allowed: T[], fallback: T): T {
  const value = record[key]
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback
}

function readOptionalUnion<T extends string>(record: Record<string, unknown>, key: string, allowed: T[]): T | null {
  const value = record[key]
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : null
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

export function mapEvalRunRow(item: Record<string, unknown>): EvalRunRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  return {
    id,
    agentDefinitionId: readString(item, 'agent_definition_id') ?? '',
    trigger: readUnion(item, 'trigger', SUITE_TRIGGERS, 'manual'),
    status: readUnion(item, 'status', SUITE_STATUSES, 'queued'),
    outcome: readOptionalUnion(item, 'outcome', SUITE_OUTCOMES),
    caseCount: readNumber(item, 'case_count') ?? 0,
    errorCount: readNumber(item, 'error_count') ?? 0,
    passScore: readNumber(item, 'pass_score'),
    scoreVariance: readNumber(item, 'score_variance'),
    repeatCount: readNumber(item, 'repeat_count') ?? 1,
    judgeMayGate: readBoolean(item, 'judge_may_gate'),
    triggeredBy: readString(item, 'triggered_by'),
    startedAt: readString(item, 'started_at'),
    finishedAt: readString(item, 'finished_at'),
    createdAt: readString(item, 'created_at'),
  }
}

export function mapEvalRunDetail(item: Record<string, unknown>): EvalRunDetailView | null {
  const base = mapEvalRunRow(item)
  if (!base) return null
  return {
    ...base,
    releaseId: readString(item, 'release_id'),
    evalSetVersion: readString(item, 'eval_set_version'),
    safetyRegressions: readStringList(item.safety_regressions),
    summary: item.summary ?? null,
  }
}

export function mapEvalCaseRun(item: Record<string, unknown>): EvalCaseRunRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const passed = item.passed
  return {
    id,
    evalCaseId: readString(item, 'eval_case_id') ?? '',
    agentRunId: readString(item, 'agent_run_id'),
    trialIndex: readNumber(item, 'trial_index') ?? 0,
    status: readUnion(item, 'status', CASE_RUN_STATUSES, 'pending'),
    passed: typeof passed === 'boolean' ? passed : null,
    score: readNumber(item, 'score'),
    latencyMs: readNumber(item, 'latency_ms'),
    costMinor: readNumber(item, 'cost_minor'),
    errorMessage: readString(item, 'error_message'),
    createdAt: readString(item, 'created_at'),
  }
}

export function mapEvalAssertionResult(item: Record<string, unknown>): EvalAssertionResultRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const passed = item.passed
  return {
    id,
    assertionId: readString(item, 'assertion_id') ?? '',
    assertionKey: readString(item, 'assertion_key') ?? '',
    passed: typeof passed === 'boolean' ? passed : null,
    score: readNumber(item, 'score'),
    severity: readUnion(item, 'severity', ['gate', 'warn'] as EvalSeverityState[], 'warn'),
    evidence: item.evidence ?? null,
    evaluatedAt: readString(item, 'evaluated_at'),
  }
}

export function mapEvalCase(item: Record<string, unknown>): EvalCaseView | null {
  const id = readString(item, 'id')
  if (!id) return null
  return {
    id,
    status: readString(item, 'status') ?? '',
    sourceType: readString(item, 'source_type') ?? '',
    processType: readString(item, 'process_type'),
    input: item.input ?? null,
    expected: item.expected ?? null,
    updatedAt: readString(item, 'updated_at'),
  }
}

/**
 * Reads the structured diff a `json_match` result carries. Results written before
 * the diff existed only have `mismatches` (paths), so those render as rows with no
 * expected/actual rather than disappearing.
 */
export function readEvidenceMismatches(evidence: unknown): {
  rows: EvalMismatchRow[]
  omitted: number
} {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { rows: [], omitted: 0 }
  }
  const record = evidence as Record<string, unknown>
  const omitted = readNumber(record, 'diffOmitted') ?? 0
  const diff = record.diff
  if (Array.isArray(diff)) {
    const rows = diff.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return []
      const path = readString(entry as Record<string, unknown>, 'path')
      if (!path) return []
      const detail = entry as Record<string, unknown>
      return [{ path, expected: detail.expected ?? null, actual: detail.actual ?? null }]
    })
    return { rows, omitted }
  }
  const paths = readStringList(record.mismatches)
  return {
    rows: paths.map((path) => ({ path, expected: undefined, actual: undefined })),
    omitted,
  }
}

/** Evidence keys already rendered by the mismatch table — not repeated as raw JSON. */
const RENDERED_EVIDENCE_KEYS = new Set(['mismatches', 'diff', 'diffOmitted'])

/** The evidence left over once the mismatch table has consumed its own keys. */
export function residualEvidence(evidence: unknown): unknown {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence
  const entries = Object.entries(evidence as Record<string, unknown>).filter(
    ([key]) => !RENDERED_EVIDENCE_KEYS.has(key),
  )
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/** Narrows a case-run status arriving from an SSE payload (untyped `unknown`). */
export function parseCaseRunStatus(value: unknown): EvalCaseRunStatusState | null {
  return typeof value === 'string' && (CASE_RUN_STATUSES as string[]).includes(value)
    ? (value as EvalCaseRunStatusState)
    : null
}

export const evalSuiteStatusVariant: Record<EvalSuiteStatusState, StatusBadgeVariant> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
}

/**
 * `advisory` is deliberately neutral, not a warning: an advisory run made no
 * gate claim at all, so painting it amber would read as "something is wrong".
 */
export const evalSuiteOutcomeVariant: Record<EvalSuiteOutcomeState, StatusBadgeVariant> = {
  passed: 'success',
  failed: 'error',
  advisory: 'neutral',
}

/**
 * `error` is warning, not error-red: an errored case run produced NO verdict
 * (it is excluded from `pass_score`), so it must not read as a failed
 * assertion. `failed` owns the red.
 */
export const evalCaseRunStatusVariant: Record<EvalCaseRunStatusState, StatusBadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  passed: 'success',
  failed: 'error',
  error: 'warning',
  skipped: 'neutral',
}

export const evalVerdictVariant: Record<EvalVerdictState, StatusBadgeVariant> = {
  passed: 'success',
  failed: 'error',
  skipped: 'neutral',
}

/** Three-state verdict: `null` is SKIPPED, never a failure. */
export function evalVerdictState(passed: boolean | null): EvalVerdictState {
  if (passed === true) return 'passed'
  if (passed === false) return 'failed'
  return 'skipped'
}

const TERMINAL_CASE_RUN_STATUSES: EvalCaseRunStatusState[] = ['passed', 'failed', 'error', 'skipped']

export function isTerminalCaseRunStatus(status: EvalCaseRunStatusState): boolean {
  return TERMINAL_CASE_RUN_STATUSES.includes(status)
}

export function isActiveSuiteStatus(status: EvalSuiteStatusState): boolean {
  return status === 'queued' || status === 'running'
}

/** `pass_score` is a 0..1 ratio; the UI always shows it as a whole percentage. */
export function formatPassScore(score: number | null): string | null {
  if (score == null) return null
  return `${Math.round(score * 100)}%`
}

/**
 * A case run records `cost_minor` but NOT a currency (unlike `AgentRun`), so the
 * amount is rendered without a code rather than asserting a currency the API
 * never returned.
 */
export function formatCaseRunCost(costMinor: number | null): string | null {
  if (costMinor == null) return null
  return (costMinor / 100).toFixed(2)
}

export function formatScoreVariance(variance: number | null): string | null {
  if (variance == null) return null
  return variance.toFixed(3)
}
