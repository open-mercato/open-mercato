import { createHash } from 'node:crypto'
import { guardrailSetBodySchema, type GuardrailSetBody } from '../../data/validators'

/**
 * Code-first grounding guardrail SET registry (Wave 3, Phase 4).
 *
 * A grounding set declares that a capability is FACTUAL and the cite-or-abstain
 * policy the deterministic grounding check enforces (severity of a missing /
 * unresolvable citation, the minimum citable-source score, and where the factual
 * claims live in the proposal). Authored in code here — consistent with the
 * code-first `ContextModule` registry (`lib/context/registry.ts`) and the spec's
 * "versioned sets per capability" intent. The set body is synced to the
 * `agent_guardrail_sets` table CONTENT-HASH idempotent during `setup.ts`
 * `seedDefaults`; the hash IS the version recorded on every grounding check, so
 * editing a body produces a new version and a re-sync of an unchanged body is a
 * no-op.
 *
 * Non-factual capabilities have NO grounding set and so are completely unaffected
 * by the grounding gate (the registry returns null for them).
 */

const REGISTRY = new Map<string, GuardrailSetBody>()

/**
 * Canonical-JSON content hash of a set body. Keys are sorted so the hash is
 * stable across declaration order — the durable, replayable version key.
 */
export function guardrailSetVersionFor(body: GuardrailSetBody): string {
  const canonical = JSON.stringify(body, Object.keys(body).sort())
  return `g1-${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`
}

export function registerGroundingSet(body: GuardrailSetBody): void {
  const parsed = guardrailSetBodySchema.parse(body)
  REGISTRY.set(parsed.capability, parsed)
}

/** Resolve the grounding set for a capability, or null when none is declared. */
export function resolveGroundingSet(capability: string): GuardrailSetBody | null {
  return REGISTRY.get(capability) ?? null
}

/** The full declared set list (sync source + test/inspection helper). */
export function listGroundingSets(): GuardrailSetBody[] {
  return [...REGISTRY.values()]
}

// ── Seed: the example factual capability ────────────────────────────────────
// `deals.health_check` reads structured deal facts + retrieval fill (see the
// context registry) — its proposal claims must trace to those cited sources.
registerGroundingSet(
  guardrailSetBodySchema.parse({
    capability: 'deals.health_check',
    factual: true,
    kind: 'grounding',
    claimsPath: 'proposal.claims',
    missingCitation: 'block',
    unresolvableCitation: 'block',
    minScore: 0,
  }),
)
