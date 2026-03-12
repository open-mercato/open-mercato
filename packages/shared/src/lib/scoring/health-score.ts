/**
 * Configurable health score framework.
 * Modules define dimensions with weights and scoring functions.
 * The framework computes a weighted score and assigns a label.
 */

export type HealthLabel = 'excellent' | 'good' | 'fair' | 'at_risk' | 'critical'

export type HealthScoreDimension = {
  name: string
  weight: number
  compute: (params: Record<string, number | null>) => number
}

export type HealthScoreConfig = {
  dimensions: HealthScoreDimension[]
  labelThresholds?: {
    excellent: number
    good: number
    fair?: number
    at_risk: number
  }
}

export type HealthScoreResult = {
  score: number
  label: HealthLabel
  dimensions: Array<{ name: string; score: number; weight: number }>
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function labelFromScore(
  score: number,
  thresholds: { excellent: number; good: number; fair?: number; at_risk: number },
): HealthLabel {
  if (score >= thresholds.excellent) return 'excellent'
  if (score >= thresholds.good) return 'good'
  if (thresholds.fair !== undefined && score >= thresholds.fair) return 'fair'
  if (score >= thresholds.at_risk) return 'at_risk'
  return 'critical'
}

/**
 * Compute a health score from configurable dimensions.
 *
 * @param config - Dimensions with weights and optional label thresholds
 * @param params - Input parameters passed to each dimension's compute function
 * @returns Score (0-100), label, and per-dimension breakdown
 */
export function computeHealthScore(
  config: HealthScoreConfig,
  params: Record<string, number | null>,
): HealthScoreResult {
  const thresholds = config.labelThresholds ?? {
    excellent: 80,
    good: 60,
    at_risk: 40,
  }

  const dimensionResults: Array<{ name: string; score: number; weight: number }> = []

  let totalWeight = 0
  let weightedSum = 0

  for (const dimension of config.dimensions) {
    const score = clamp(dimension.compute(params), 0, 100)
    dimensionResults.push({ name: dimension.name, score, weight: dimension.weight })
    weightedSum += score * dimension.weight
    totalWeight += dimension.weight
  }

  const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0

  return {
    score: clamp(finalScore, 0, 100),
    label: labelFromScore(finalScore, thresholds),
    dimensions: dimensionResults,
  }
}

// --- Pre-built scoring functions for common patterns ---

/**
 * Score based on recency (days since last event).
 * More recent = higher score.
 */
export function recencyScore(
  daysSinceEvent: number | null,
  thresholds: { excellent: number; good: number; fair: number; poor: number } = {
    excellent: 7, good: 14, fair: 30, poor: 60,
  },
): number {
  if (daysSinceEvent === null) return 0
  if (daysSinceEvent <= thresholds.excellent) return 100
  if (daysSinceEvent <= thresholds.good) return 80
  if (daysSinceEvent <= thresholds.fair) return 60
  if (daysSinceEvent <= thresholds.poor) return 30
  return 10
}

/**
 * Score based on a ratio (actual / expected).
 * Higher ratio = higher score.
 */
export function ratioScore(
  actual: number,
  expected: number,
  thresholds: { full: number; good: number; fair: number; poor: number } = {
    full: 1.0, good: 0.8, fair: 0.5, poor: 0.2,
  },
): number {
  if (expected <= 0) return 50
  const ratio = actual / expected
  if (ratio >= thresholds.full) return 100
  if (ratio >= thresholds.good) return 80
  if (ratio >= thresholds.fair) return 50
  if (ratio >= thresholds.poor) return 25
  return 0
}

/**
 * Score based on a count threshold.
 * Higher count = higher score.
 */
export function countScore(
  count: number,
  thresholds: { excellent: number; good: number; fair: number; poor: number } = {
    excellent: 10, good: 6, fair: 3, poor: 1,
  },
): number {
  if (count >= thresholds.excellent) return 100
  if (count >= thresholds.good) return 80
  if (count >= thresholds.fair) return 60
  if (count >= thresholds.poor) return 40
  return 10
}
