import type { Json, ScorerDefinition, ScorerDescriptor, ScorerRunView, ScorerVerdict } from '../types'
import { SKIP_REASON, skipped } from '../types'
import { agentScorers } from './agent'
import { economicsScorers } from './economics'
import { judgeScorers } from './judge'
import { structuredScorers } from './structured'
import { textScorers } from './text'
import { toolScorers } from './tools'

/**
 * The single source of truth for scorer identity. 21 definitions — 20 deterministic
 * plus `llm_judge` — consumed by the online plane (EvalRuntimeService), the offline
 * plane (replay engine, CI gate) and `GET /eval-scorers`, which generates the
 * assertion form from `fields`.
 */
const definitions: ReadonlyArray<ScorerDefinition<never>> = [
  ...textScorers,
  ...structuredScorers,
  ...toolScorers,
  ...economicsScorers,
  ...agentScorers,
  ...judgeScorers,
] as unknown as ReadonlyArray<ScorerDefinition<never>>

const registry = new Map<string, ScorerDefinition<never>>(
  definitions.map((definition) => [definition.scorerKey, definition]),
)

/**
 * Renamed keys. `min_confidence` is the only alias: it and `confidence_threshold`
 * both read `run.confidence` and neither touches `expected`, so the rename is
 * provably behaviour-preserving. `required_keys` is deliberately NOT aliased — see
 * the note on its definition.
 */
export const DEPRECATED_SCORER_ALIASES: Readonly<Record<string, string>> = {
  min_confidence: 'confidence_threshold',
}

export function getScorerDefinition(scorerKey: string): ScorerDefinition<never> | undefined {
  const canonical = DEPRECATED_SCORER_ALIASES[scorerKey] ?? scorerKey
  return registry.get(canonical)
}

export function listScorerDefinitions(): ReadonlyArray<ScorerDefinition<never>> {
  return definitions
}

/**
 * Resolution chain, widest-compatible first:
 *   1. the `scorer_key` column (Phase 1 onward)
 *   2. `config.scorer` — the undocumented indirection shipped before this column
 *      existed, retained as a read-fallback for ≥1 minor
 *   3. the assertion `key`, which used to double as the scorer identity
 */
export function resolveScorerKey(assertion: {
  scorerKey?: string | null
  key: string
  config?: unknown
}): string {
  if (assertion.scorerKey) return assertion.scorerKey
  const config = (assertion.config as Record<string, unknown> | null) ?? {}
  if (typeof config.scorer === 'string' && config.scorer) return config.scorer
  return assertion.key
}

/** Serializable projection for the browser — never ships `configSchema` or `score`. */
export function describeScorers(): ScorerDescriptor[] {
  const described = definitions.map((definition) => ({
    scorerKey: definition.scorerKey,
    labelKey: definition.labelKey,
    group: definition.group,
    kind: definition.kind,
    fields: definition.fields,
  }))
  const aliases = Object.entries(DEPRECATED_SCORER_ALIASES).flatMap(([alias, canonical]) => {
    const target = registry.get(canonical)
    if (!target) return []
    return [
      {
        scorerKey: alias,
        labelKey: `agent_orchestrator.evalAssertions.scorer.${alias}`,
        group: target.group,
        kind: target.kind,
        fields: target.fields,
        deprecated: true,
        deprecatedInFavourOf: canonical,
      },
    ]
  })
  return [...described, ...aliases]
}

export type ScorerConfigParseResult =
  | { ok: true; config: unknown }
  | { ok: false; issues: string[] }

/**
 * Validates a raw config against its scorer's schema.
 *
 * `mode: 'write'` uses the stricter `writeConfigSchema` where one exists — range
 * and shape checks belong at the API boundary (422), never at evaluation time,
 * because rejecting a STORED config there turns an existing verdict into a skip
 * and can flip a gate open.
 */
export function parseScorerConfig(
  scorerKey: string,
  rawConfig: unknown,
  mode: 'read' | 'write' = 'read',
): ScorerConfigParseResult {
  const definition = getScorerDefinition(scorerKey)
  if (!definition) return { ok: false, issues: [`unknown scorer "${scorerKey}"`] }

  // `config.scorer` is the deprecated indirection: strip it before validation so a
  // legacy row does not fail on an unrecognised property.
  const source = (rawConfig as Record<string, unknown> | null) ?? {}
  const { scorer: _legacyScorerKey, ...rest } = source
  const schema = mode === 'write' ? definition.writeConfigSchema ?? definition.configSchema : definition.configSchema
  const parsed = schema.safeParse(rest)
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '.'}: ${issue.message}`) }
  }
  return { ok: true, config: parsed.data }
}

/**
 * Runs one assertion end to end: validates config, applies the runtime
 * `needsExpected` skip, delegates to the pure scorer, then applies `negate`
 * centrally so no individual scorer implements it.
 *
 * An invalid config or an unknown key yields a SKIPPED verdict, never a failed
 * one — a config typo must stay visible without flipping `AgentRun.evalPassed`.
 */
export function runScorer(
  scorerKey: string,
  run: ScorerRunView,
  expected: Json | null,
  rawConfig: unknown,
): ScorerVerdict {
  const definition = getScorerDefinition(scorerKey)
  if (!definition) return skipped(SKIP_REASON.unknownScorer, { scorerKey })

  const parsed = parseScorerConfig(scorerKey, rawConfig)
  if (!parsed.ok) return skipped(SKIP_REASON.invalidConfig, { scorerKey, issues: parsed.issues })

  const config = parsed.config as never
  if (definition.needsExpected(config) && expected === null) return skipped(SKIP_REASON.noExpected, { scorerKey })

  const verdict = definition.score(run, expected, config)
  const negate = Boolean((parsed.config as { negate?: boolean }).negate)
  if (!negate || verdict.passed === null) return verdict

  return {
    passed: !verdict.passed,
    score: verdict.score === null ? null : 1 - verdict.score,
    evidence: verdict.evidence,
  }
}
