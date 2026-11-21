/**
 * Loyalty tiers, derived from the lead score rather than stored.
 *
 * Stored tiers drift: the score changes continuously, so a tier column would need a job to keep it
 * true and would be wrong in between. Deriving it means the tier is never stale and there is nothing
 * to migrate when the thresholds change — the same reason the score itself is summed from its ledger
 * rather than cached in a column.
 */

export type TierThreshold = {
  /** Data, not a label: a tenant may rename or add tiers, and translations fall back to the key. */
  key: string
  /** Inclusive lower bound in points. */
  minPoints: number
}

/**
 * The default ladder.
 *
 * Present so the feature works before anybody configures anything — a tier system that requires
 * setup before it does anything is a tier system nobody sees.
 */
export const DEFAULT_TIER_THRESHOLDS: TierThreshold[] = [
  { key: 'bronze', minPoints: 0 },
  { key: 'silver', minPoints: 100 },
  { key: 'gold', minPoints: 500 },
]

/**
 * Normalises a configured ladder.
 *
 * Sorted ascending and de-duplicated by bound, because the resolution below walks it downwards and a
 * ladder in the wrong order would silently award the wrong tier rather than fail. A malformed entry is
 * dropped; an empty result falls back to the defaults, because "no tiers at all" is never what
 * somebody meant by editing the setting.
 */
export function normalizeTierThresholds(input: unknown): TierThreshold[] {
  if (!Array.isArray(input)) return DEFAULT_TIER_THRESHOLDS
  const parsed: TierThreshold[] = []
  const seenBounds = new Set<number>()
  for (const candidate of input) {
    if (!candidate || typeof candidate !== 'object') continue
    const entry = candidate as { key?: unknown; minPoints?: unknown }
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    const minPoints = typeof entry.minPoints === 'number' ? entry.minPoints : Number(entry.minPoints)
    if (!key || !Number.isFinite(minPoints)) continue
    if (seenBounds.has(minPoints)) continue
    seenBounds.add(minPoints)
    parsed.push({ key, minPoints })
  }
  if (parsed.length === 0) return DEFAULT_TIER_THRESHOLDS
  return parsed.sort((left, right) => left.minPoints - right.minPoints)
}

export type ResolvedTier = {
  /** The tier's key, or null when the score is below every configured bound. */
  key: string | null
  /**
   * Position in the ladder, so an audience can express "at least silver" as `score.tierRank >= 1`.
   * -1 when below every bound, which keeps every `>=` comparison false rather than accidentally true.
   */
  rank: number
  /** Points still needed for the next tier, or null at the top. Shown in the customer profile. */
  pointsToNext: number | null
}

/** The highest tier whose bound the score has reached. */
export function resolveTier(points: number, thresholds: TierThreshold[] = DEFAULT_TIER_THRESHOLDS): ResolvedTier {
  const ladder = normalizeTierThresholds(thresholds)
  let rank = -1
  for (let index = 0; index < ladder.length; index += 1) {
    if (points >= ladder[index].minPoints) rank = index
    else break
  }
  const next = ladder[rank + 1]
  return {
    key: rank >= 0 ? ladder[rank].key : null,
    rank,
    pointsToNext: next ? next.minPoints - points : null,
  }
}
