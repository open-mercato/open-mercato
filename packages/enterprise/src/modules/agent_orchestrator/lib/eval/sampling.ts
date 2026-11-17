/**
 * Deterministic sampling for the (paid, async) llm_judge tier. A judge call is a
 * cost-prohibitive LLM round-trip, so it runs only on a sampled subset. The
 * decision is a pure function of the run id — same run → same decision — so an
 * idempotent re-ingest never re-rolls and the rate is reproducible in tests.
 */
const DEFAULT_SAMPLE_RATE = 0.1

/** FNV-1a → [0, 1). Stable, dependency-free, no Math.random (keeps it pure/testable). */
function unitHash(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000
}

/** Resolve the configured judge sample rate (clamped to [0, 1]). */
export function resolveJudgeSampleRate(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OM_AGENT_LLM_JUDGE_SAMPLE_RATE
  if (raw === undefined || raw === '') return DEFAULT_SAMPLE_RATE
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_RATE
  return Math.min(1, Math.max(0, parsed))
}

/** True when `runId` falls within the sampled fraction `rate`. */
export function shouldSampleForJudge(runId: string, rate: number): boolean {
  if (rate <= 0) return false
  if (rate >= 1) return true
  return unitHash(runId) < rate
}
