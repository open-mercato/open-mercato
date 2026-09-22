/**
 * Decides which adapters a health request is allowed to call.
 *
 * This is the rule that keeps a status screen from being a billing event, so it
 * lives apart from the route: it is the one piece worth testing without a live
 * adapter, a container, or a credit card.
 *
 * PURE.
 */

export type ProbeCost = 'free' | 'heavy' | 'billable'

/**
 * `readiness` reports configuration only. `auto` additionally calls whatever is
 * free — what a page view may do. `live` is the operator-initiated, gated path
 * that may spend.
 */
export type ProbeMode = 'readiness' | 'auto' | 'live'

export type ProbeCandidate = {
  id: string
  ready: boolean
  probeCost: ProbeCost
}

export type ProbePlanInput = {
  candidates: readonly ProbeCandidate[]
  /** Age of each adapter's cached probe, in ms. Absent means never probed. */
  ageMsById: ReadonlyMap<string, number>
  mode: ProbeMode
  force: boolean
  ttlMs: number
  /** Narrows a live probe to one adapter, so re-testing one cannot bill the rest. */
  adapterId?: string | null
}

/** Even an explicit `force` may not re-bill inside this window. */
export const FORCE_FLOOR_MS = 30_000

export function selectProbeTargets(input: ProbePlanInput): string[] {
  const { candidates, ageMsById, mode, force, ttlMs, adapterId } = input
  if (mode === 'readiness') return []

  return candidates
    .filter((candidate) => candidate.ready)
    .filter((candidate) => !adapterId || candidate.id === adapterId)
    .filter((candidate) => {
      // Free probes are the whole reason the tile can be green on entry: they
      // cost nothing, so they are never rationed.
      if (candidate.probeCost === 'free') return true
      if (mode === 'auto') return false
      // For anything that costs, the cache IS the rate limit — and `force` only
      // shortens the wait, it does not remove it.
      const age = ageMsById.get(candidate.id) ?? Number.POSITIVE_INFINITY
      return force ? age >= FORCE_FLOOR_MS : age >= ttlMs
    })
    .map((candidate) => candidate.id)
}
