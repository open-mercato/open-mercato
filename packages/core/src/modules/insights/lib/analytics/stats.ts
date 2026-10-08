import {
  XRAY_AGE_BUCKETS,
  XRAY_STATS_GUARDS,
  type AgeHistogram,
  type DurationStats,
  type SuppressionSummary,
  type XrayAgeBucket,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000

const Z_95 = 1.959963984540054

const AGE_BUCKET_LIMITS: ReadonlyArray<{ bucket: XrayAgeBucket; belowMs: number }> = [
  { bucket: 'lt_1d', belowMs: DAY_MS },
  { bucket: '1d_7d', belowMs: 7 * DAY_MS },
  { bucket: '7d_30d', belowMs: 30 * DAY_MS },
  { bucket: '30d_90d', belowMs: 90 * DAY_MS },
]

export function sortAscending(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
}

/**
 * Continuous quantile of ascending values with linear interpolation between the closest
 * ranks (PostgreSQL `percentile_cont`), so live and SQL-aggregated figures agree.
 */
export function quantile(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(probability)) return null
  const bounded = Math.min(1, Math.max(0, probability))
  const position = (sorted.length - 1) * bounded
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function isLowConfidence(n: number): boolean {
  return n < XRAY_STATS_GUARDS.lowConfidenceN
}

function roundMs(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value))
}

/** Applies the reporting guards: median needs n ≥ 5, p90 needs n ≥ 20, n < 30 is low-confidence. */
export function guardDurationStats(n: number, medianMs: number | null, p90Ms: number | null): DurationStats {
  return {
    n,
    medianMs: n >= XRAY_STATS_GUARDS.minMedianN ? roundMs(medianMs) : null,
    p90Ms: n >= XRAY_STATS_GUARDS.minP90N ? roundMs(p90Ms) : null,
    lowConfidence: isLowConfidence(n),
  }
}

export function summarizeDurations(values: readonly number[]): DurationStats {
  const sorted = sortAscending(values)
  return guardDurationStats(sorted.length, quantile(sorted, 0.5), quantile(sorted, 0.9))
}

export function guardedMedian(values: readonly number[]): number | null {
  return summarizeDurations(values).medianMs
}

export function guardedP90(values: readonly number[]): number | null {
  return summarizeDurations(values).p90Ms
}

/** Lower bound of the Wilson score interval (95 % by default) of `successes / trials`. */
export function wilsonLowerBound(successes: number, trials: number, z: number = Z_95): number | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) return null
  const bounded = Math.min(Math.max(successes, 0), trials)
  const share = bounded / trials
  const zSquared = z * z
  const centre = share + zSquared / (2 * trials)
  const margin = z * Math.sqrt((share * (1 - share) + zSquared / (4 * trials)) / trials)
  const lower = (centre - margin) / (1 + zSquared / trials)
  return Math.min(1, Math.max(0, lower))
}

/** Lift of a rule: its confidence over the base rate of the consequent. */
export function lift(confidence: number, baseRate: number): number | null {
  if (!Number.isFinite(confidence) || !Number.isFinite(baseRate) || baseRate <= 0) return null
  return confidence / baseRate
}

export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.min(1, Math.max(0, numerator / denominator))
}

/** The k-anonymity threshold in force: the setting, never below the platform minimum. */
export function effectiveKAnonymity(value: number | null | undefined): number {
  const configured = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : XRAY_STATS_GUARDS.defaultK
  return Math.max(configured, XRAY_STATS_GUARDS.minK)
}

export type CellPrivacyFacts = {
  cases: number
  actors: number
}

export type SuppressionReason = 'min_cases' | 'min_actors'

/**
 * Why a reported cell must be suppressed, or `null` when it may be shown. A cell needs at
 * least `k` cases; a cell with identifiable actors needs at least three of them (a cell of
 * automated steps only has no person to protect). The per-person view of one actor applies
 * the case threshold alone (`actorRule: false`): its explicit opt-in gates stand in for it.
 */
export function suppressionReason(cell: CellPrivacyFacts, k: number, options: { actorRule: boolean } = { actorRule: true }): SuppressionReason | null {
  if (cell.cases < k) return 'min_cases'
  if (options.actorRule && cell.actors > 0 && cell.actors < XRAY_STATS_GUARDS.minDistinctActors) return 'min_actors'
  return null
}

export type SuppressionTally = {
  record: (reason: SuppressionReason) => void
  summary: () => SuppressionSummary
}

export function createSuppressionTally(): SuppressionTally {
  let minCases = 0
  let minActors = 0
  return {
    record(reason) {
      if (reason === 'min_cases') minCases += 1
      else minActors += 1
    },
    summary() {
      return { cells: minCases + minActors, minCases, minActors }
    },
  }
}

export function emptySuppression(): SuppressionSummary {
  return { cells: 0, minCases: 0, minActors: 0 }
}

export function ageBucket(ms: number): XrayAgeBucket {
  for (const limit of AGE_BUCKET_LIMITS) {
    if (ms < limit.belowMs) return limit.bucket
  }
  return 'gte_90d'
}

export function buildHistogram(values: readonly number[]): AgeHistogram {
  const counts = new Map<XrayAgeBucket, number>(XRAY_AGE_BUCKETS.map((bucket) => [bucket, 0]))
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    const bucket = ageBucket(Math.max(0, value))
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  return XRAY_AGE_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }))
}

export function histogramFromCounts(counts: Partial<Record<XrayAgeBucket, number>>): AgeHistogram {
  return XRAY_AGE_BUCKETS.map((bucket) => ({ bucket, count: Math.max(0, Math.trunc(counts[bucket] ?? 0)) }))
}

export function emptyHistogram(): AgeHistogram {
  return histogramFromCounts({})
}

export const AGE_BUCKET_BOUNDS_MS = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  quarter: 90 * DAY_MS,
} as const
