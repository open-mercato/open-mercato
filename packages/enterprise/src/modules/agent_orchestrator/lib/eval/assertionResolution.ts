import type { AgentEvalAssertion } from '../../data/entities'
import { evalCaseAssertionRefSchema } from '../../data/validators'
import { parseScorerConfig, resolveScorerKey } from './registry'

/**
 * Per-case override of a suite-level assertion. References are by `assertionId`,
 * NOT by key: `agent_eval_assertions_key_uq` is unique per (org, appliesTo, key),
 * so a `'*'` row and an agent-specific row routinely share a slug and a key-based
 * reference would be ambiguous.
 */
export type EvalCaseAssertionRef = {
  assertionId: string
  /** Shallow-merged over the stored config, then RE-VALIDATED against the scorer. */
  configOverride?: Record<string, unknown> | null
  /** Opt out of an inherited assertion for this case only. */
  disabled?: boolean
}

export type ResolvedAssertion = {
  assertion: AgentEvalAssertion
  scorerKey: string
  /** Stored config with any case-level override merged in. */
  config: unknown
  /** Set when the merged config failed validation — the caller records a skip. */
  configError?: string[]
}

/**
 * Parses the stored `AgentEvalCase.assertions` column through the SAME zod schema
 * the write path uses, so there is one definition of the shape rather than two
 * that can drift. Malformed entries are dropped rather than failing the case: the
 * column predates validation, so a legacy row must still be replayable.
 */
export function parseCaseAssertionRefs(raw: unknown): EvalCaseAssertionRef[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const parsed = evalCaseAssertionRefSchema.safeParse(entry)
    if (!parsed.success) return []
    return [
      {
        assertionId: parsed.data.assertionId,
        configOverride: parsed.data.configOverride ?? null,
        disabled: parsed.data.disabled === true,
      },
    ]
  })
}

/**
 * Effective assertion set for one case.
 *
 * Precedence: an agent-specific assertion SHADOWS a `'*'` assertion sharing the
 * same `key` slug — a tenant tightening one agent's rule should not end up running
 * both the general and the specific version. Case-level refs then apply on top:
 * `disabled` removes, `configOverride` merges.
 *
 * The merged config is re-validated. Without that, a case-level override would
 * reintroduce exactly the malformed-config-silently-tolerated failure the typed
 * registry exists to eliminate.
 */
export function resolveEffectiveAssertions(
  assertions: ReadonlyArray<AgentEvalAssertion>,
  refs: ReadonlyArray<EvalCaseAssertionRef>,
): ResolvedAssertion[] {
  const bySlug = new Map<string, AgentEvalAssertion>()
  for (const assertion of assertions) {
    const current = bySlug.get(assertion.key)
    if (!current) {
      bySlug.set(assertion.key, assertion)
      continue
    }
    // Agent-specific wins over the '*' wildcard — EXCEPT it may not weaken the
    // gate tier. A tenant-wide `gate` assertion being silently replaced by an
    // agent-scoped `warn` one sharing its slug would drop a gate with no error,
    // and the seeded defaults ship exactly such a `'*'` gate (`output_present`).
    const incomingIsSpecific = assertion.appliesTo !== '*'
    const currentIsSpecific = current.appliesTo !== '*'
    const wouldWeakenGate = current.severity === 'gate' && assertion.severity !== 'gate'
    if (incomingIsSpecific && !currentIsSpecific && !wouldWeakenGate) bySlug.set(assertion.key, assertion)
  }

  const refsById = new Map(refs.map((ref) => [ref.assertionId, ref]))
  const resolved: ResolvedAssertion[] = []

  for (const assertion of bySlug.values()) {
    const ref = refsById.get(assertion.id)
    if (ref?.disabled) continue

    const scorerKey = resolveScorerKey(assertion)
    const stored = (assertion.config as Record<string, unknown> | null) ?? {}
    const config = ref?.configOverride ? { ...stored, ...ref.configOverride } : stored

    if (ref?.configOverride) {
      const parsed = parseScorerConfig(scorerKey, config)
      if (!parsed.ok) {
        resolved.push({ assertion, scorerKey, config, configError: parsed.issues })
        continue
      }
    }

    resolved.push({ assertion, scorerKey, config })
  }

  return resolved
}
