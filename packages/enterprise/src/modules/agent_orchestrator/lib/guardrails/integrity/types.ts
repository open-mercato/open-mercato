import type { AwilixContainer } from 'awilix'
import type { CitableSource, GuardrailCheck, IntegrityRule } from '../../../data/validators'

/**
 * The shared contract every output-integrity rule implements (spec
 * `2026-10-21-output-integrity-guardrails` → Pipeline order). A rule receives the
 * output produced by the previous rule and returns a NEW output plus exactly one
 * redacted check; it never mutates `ctx.output` or `ctx.input`.
 */
export type IntegrityToolCall = {
  toolName: string
  args: unknown
  result: unknown
  error?: string
}

export type IntegrityRuleScope = {
  tenantId: string
  organizationId: string | null
}

export type IntegrityRuleContext = {
  /** The current result envelope; rule paths are relative to it. */
  output: unknown
  /** The run input; `source.input` and similar paths resolve into it. */
  input: unknown
  /** In-memory tool calls of the run, in call order. */
  toolCalls: readonly IntegrityToolCall[]
  /**
   * In-memory tool calls of the run's in-process `delegate_agent` sub-runs, in
   * call order; collected only when a rule opts in with `includeSubRuns`.
   */
  subRunToolCalls?: readonly IntegrityToolCall[]
  /** Citable sources assembled for the run's context bundle (handed to custom checkers). */
  citableSources?: readonly CitableSource[]
  /** Version of the integrity rule set the check rows pin. */
  guardrailSetVersion: string
  scope?: IntegrityRuleScope
  container?: AwilixContainer
}

export type IntegrityViolation = {
  itemPath: string
  reason: string
}

export const MAX_EVIDENCE_VIOLATIONS = 20

export type IntegrityRuleOutcome = {
  output: unknown
  check: GuardrailCheck
  changed: boolean
  blocked: boolean
}

/**
 * Rules may be synchronous (`evidence_quote`) or asynchronous (resolver-backed
 * kinds); the pipeline always awaits the returned value.
 */
export type IntegrityRuleEvaluator<Rule extends IntegrityRule = IntegrityRule> = (
  ctx: IntegrityRuleContext,
  rule: Rule,
) => IntegrityRuleOutcome | Promise<IntegrityRuleOutcome>
