export type HealthLabel = 'excellent' | 'good' | 'at_risk' | 'critical'

export type HealthScoreResult = {
  score: number
  label: HealthLabel
  components: {
    activityRecency: number
    dealPipelineHealth: number
    orderFrequency: number
    interactionCount: number
  }
}

function labelFromScore(score: number): HealthLabel {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'at_risk'
  return 'critical'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function computeActivityRecencyScore(daysSinceLastActivity: number | null): number {
  if (daysSinceLastActivity === null) return 0
  if (daysSinceLastActivity <= 7) return 100
  if (daysSinceLastActivity <= 14) return 80
  if (daysSinceLastActivity <= 30) return 60
  if (daysSinceLastActivity <= 60) return 30
  return 10
}

export function computeDealPipelineScore(
  advancingDeals: number,
  stalledDeals: number,
  totalOpenDeals: number,
): number {
  if (totalOpenDeals === 0) return 50
  const advancingRatio = advancingDeals / totalOpenDeals
  const stalledRatio = stalledDeals / totalOpenDeals
  const score = (advancingRatio * 100) - (stalledRatio * 50)
  return clamp(Math.round(score), 0, 100)
}

export function computeOrderFrequencyScore(
  actualOrdersInPeriod: number,
  expectedOrdersInPeriod: number,
): number {
  if (expectedOrdersInPeriod <= 0) return 50
  const ratio = actualOrdersInPeriod / expectedOrdersInPeriod
  if (ratio >= 1.0) return 100
  if (ratio >= 0.8) return 80
  if (ratio >= 0.5) return 50
  if (ratio >= 0.2) return 25
  return 0
}

export function computeInteractionCountScore(
  monthlyInteractions: number,
): number {
  if (monthlyInteractions >= 10) return 100
  if (monthlyInteractions >= 6) return 80
  if (monthlyInteractions >= 3) return 60
  if (monthlyInteractions >= 1) return 40
  return 10
}

export function computeHealthScore(params: {
  daysSinceLastActivity: number | null
  advancingDeals: number
  stalledDeals: number
  totalOpenDeals: number
  actualOrdersInPeriod: number
  expectedOrdersInPeriod: number
  monthlyInteractions: number
}): HealthScoreResult {
  const activityRecency = computeActivityRecencyScore(params.daysSinceLastActivity)
  const dealPipelineHealth = computeDealPipelineScore(
    params.advancingDeals,
    params.stalledDeals,
    params.totalOpenDeals,
  )
  const orderFrequency = computeOrderFrequencyScore(
    params.actualOrdersInPeriod,
    params.expectedOrdersInPeriod,
  )
  const interactionCount = computeInteractionCountScore(params.monthlyInteractions)

  const score = Math.round(
    activityRecency * 0.30 +
    dealPipelineHealth * 0.25 +
    orderFrequency * 0.25 +
    interactionCount * 0.20
  )

  return {
    score: clamp(score, 0, 100),
    label: labelFromScore(score),
    components: {
      activityRecency,
      dealPipelineHealth,
      orderFrequency,
      interactionCount,
    },
  }
}
