/**
 * Shared eval types (spec 2026-07-19-agent-eval-workbench-and-gate §3.1).
 *
 * A scorer is a PURE function — inputs in, verdict out, no EntityManager and no
 * request scope — so the identical logic runs online (inline at ingest in
 * EvalRuntimeService) and offline (the replay engine and the CI regression gate).
 * Only `deterministic` scorers may back a `gate`-severity assertion.
 */

import type { z } from 'zod'

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/**
 * Normalized, dependency-free view of an executed run. Projected from AgentRun +
 * AgentToolCall by `projectRunView`, so scorers never touch the ORM.
 */
export type ScorerRunView = {
  input: Json | null
  output: Json | null
  resultKind: 'informative' | 'actionable' | null
  confidence: number | null
  status: string
  latencyMs: number | null
  costMinor: number | null
  inputTokens: number | null
  outputTokens: number | null
  toolCalls: ReadonlyArray<ScorerToolCallView>
  stepCount: number
  disposition: string | null
}

export type ScorerToolCallView = {
  toolName: string
  args: Json | null
  status: string
  sequence: number
}

/**
 * `passed: null` means SKIPPED and is the single source of truth for it — there is
 * no separate boolean flag. Invariant asserted in unit tests:
 * `score === null` ⟺ `passed === null`.
 *
 * Skipped results are excluded from score aggregation AND pass aggregation alike:
 * never counted as 0, never counted as failing.
 */
export type ScorerVerdict = {
  passed: boolean | null
  score: number | null
  evidence?: Json
}

/** Reason codes carried in `evidence.reason` when a scorer skips. */
export const SKIP_REASON = {
  noExpected: 'no_expected',
  unknownScorer: 'unknown_scorer',
  invalidConfig: 'invalid_config',
  noModelFactory: 'no_model_factory',
  /** The config is fine; the run simply lacks the input this scorer reads. */
  notApplicable: 'not_applicable',
} as const

export type SkipReason = (typeof SKIP_REASON)[keyof typeof SKIP_REASON]

export function skipped(reason: SkipReason, detail?: Json): ScorerVerdict {
  return { passed: null, score: null, evidence: detail === undefined ? { reason } : { reason, detail } }
}

/**
 * UI metadata for one config field. The assertion form is GENERATED from these —
 * never hand-maintained per scorer — which is what makes assertions clickable.
 */
export type ScorerField =
  | {
      name: string
      kind: 'number'
      labelKey: string
      hintKey?: string
      min?: number
      max?: number
      step?: number
      required?: boolean
      default?: number
    }
  /**
   * A bounded numeric where the RANGE is meaningful — a normalized 0..1 score, in
   * practice. Rendered as a slider so the bounds are visible without reading the
   * hint; a bare number input gives no clue that 0.5 is mid-scale and 85 is
   * nonsense.
   */
  | {
      name: string
      kind: 'slider'
      labelKey: string
      hintKey?: string
      min: number
      max: number
      step: number
      required?: boolean
      default?: number
    }
  | {
      name: string
      kind: 'text' | 'textarea' | 'json'
      labelKey: string
      hintKey?: string
      required?: boolean
      /** Shown in the empty control — an EXAMPLE, not an instruction. */
      placeholderKey?: string
      /**
       * Autocomplete source. `tool` offers the tool names actually registered in
       * this deployment: an assertion that names a tool the agent cannot call is
       * silently unsatisfiable, and nothing else in the form would catch it.
       * Suggestions only — a name from an agent not currently loaded is still typeable.
       */
      suggest?: 'tool'
    }
  | {
      name: string
      kind: 'string-list'
      labelKey: string
      hintKey?: string
      required?: boolean
      placeholderKey?: string
      suggest?: 'tool'
    }
  | { name: string; kind: 'boolean'; labelKey: string; hintKey?: string; default?: boolean }
  | {
      name: string
      kind: 'select'
      labelKey: string
      hintKey?: string
      options: ReadonlyArray<{ value: string; labelKey: string }>
      required?: boolean
      default?: string
    }

export type ScorerGroup = 'text' | 'structured' | 'tools' | 'economics' | 'agent' | 'judge'

/** Maps to the shipped `AgentEvalAssertion.type` column. */
export type ScorerKind = 'deterministic' | 'llm_judge'

export type ScorerDefinition<TConfig = unknown> = {
  scorerKey: string
  labelKey: string
  group: ScorerGroup
  kind: ScorerKind
  /**
   * EVALUATION-time schema. MUST be at least as permissive as whatever the scorer
   * previously accepted: a stored config that used to produce a real verdict must
   * keep producing one. Parse failure here yields a SKIPPED result, which is
   * excluded from aggregation — so tightening this schema can silently REMOVE an
   * existing gate failure and flip `evalPassed` from false to true. Use `.catch()`
   * for coercible fields rather than rejecting.
   */
  configSchema: z.ZodType<TConfig>
  /**
   * Optional stricter schema applied only at the WRITE boundary (422). This is
   * where range and shape constraints belong: rejecting there cannot move the
   * verdict of an already-stored assertion.
   */
  writeConfigSchema?: z.ZodType<TConfig>
  fields: ReadonlyArray<ScorerField>
  /**
   * Derived from config, NOT a static flag: a comparison scorer configured with
   * `source: 'config'` needs no expected value. Drives a UI hint and the runtime
   * skip. Returns false for scorers that never read `expected`.
   */
  needsExpected: (config: TConfig) => boolean
  score: (run: ScorerRunView, expected: Json | null, config: TConfig) => ScorerVerdict
}

/** Serializable projection sent to the browser by `GET /eval-scorers`. */
export type ScorerDescriptor = {
  scorerKey: string
  labelKey: string
  group: ScorerGroup
  kind: ScorerKind
  fields: ReadonlyArray<ScorerField>
  deprecated?: boolean
  deprecatedInFavourOf?: string
}
