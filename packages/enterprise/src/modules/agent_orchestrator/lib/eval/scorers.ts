/**
 * @deprecated Legacy scorer surface. Superseded by `lib/eval/registry` (spec
 * 2026-07-19-agent-eval-workbench-and-gate §3.1), which adds `expected`, a typed
 * per-scorer `configSchema`, generated form metadata, and skipped verdicts.
 *
 * This module is retained for ≥1 minor because it is publicly reachable through
 * `@open-mercato/enterprise`'s wildcard subpath exports as
 * `.../modules/agent_orchestrator/lib/eval/scorers`. The legacy types keep their
 * ORIGINAL shape here on purpose — widening `ScorerVerdict.passed` in place would
 * break structural consumers.
 *
 * Migration: import `runScorer` / `getScorerDefinition` from `lib/eval/registry`
 * and project runs with `projectRunView`.
 */

import { getScorerDefinition } from './registry'
import type { Json, ScorerRunView } from './types'

/** @deprecated Use `ScorerRunView` from `lib/eval/types`. */
export type ScorerRunFacts = {
  confidence?: number | null
  status?: string | null
}

/** @deprecated Use the 3-parameter `ScorerDefinition['score']` signature. */
export type ScorerInput = {
  output: unknown
  run: ScorerRunFacts
  config: Record<string, unknown>
}

/**
 * @deprecated Use `ScorerVerdict` from `lib/eval/types`, whose `passed` is
 * `boolean | null` (null = skipped). This legacy alias keeps `passed: boolean`.
 */
export type ScorerVerdict = {
  passed: boolean
  score?: number
  evidence?: unknown
}

/** @deprecated Use `ScorerDefinition` from `lib/eval/types`. */
export type Scorer = (input: ScorerInput) => ScorerVerdict

const LEGACY_KEYS = ['output_present', 'required_keys', 'min_confidence', 'no_pii'] as const

function toRunView(input: ScorerInput): ScorerRunView {
  return {
    input: null,
    output: (input.output ?? null) as Json | null,
    resultKind: null,
    confidence: input.run.confidence ?? null,
    status: input.run.status ?? 'unknown',
    latencyMs: null,
    costMinor: null,
    inputTokens: null,
    outputTokens: null,
    toolCalls: [],
    stepCount: 0,
    disposition: null,
  }
}

function legacyAdapter(scorerKey: string): Scorer {
  return (input) => {
    const definition = getScorerDefinition(scorerKey)
    if (!definition) return { passed: false, score: 0, evidence: { reason: `unknown scorer "${scorerKey}"` } }
    const parsed = definition.configSchema.safeParse(input.config ?? {})
    const config = (parsed.success ? parsed.data : {}) as never
    const verdict = definition.score(toRunView(input), null, config)
    return {
      // None of the four legacy scorers can skip, so this coercion is unreachable
      // in practice; it exists so the legacy return type stays honest.
      passed: verdict.passed ?? false,
      score: verdict.score ?? undefined,
      evidence: verdict.evidence,
    }
  }
}

/** @deprecated Use `listScorerDefinitions()` / `runScorer()` from `lib/eval/registry`. */
export const scorers: Record<string, Scorer> = Object.fromEntries(
  LEGACY_KEYS.map((key) => [key, legacyAdapter(key)]),
)

/** @deprecated Use `getScorerDefinition(scorerKey)` from `lib/eval/registry`. */
export function getScorer(key: string): Scorer | undefined {
  return getScorerDefinition(key) ? legacyAdapter(key) : undefined
}
