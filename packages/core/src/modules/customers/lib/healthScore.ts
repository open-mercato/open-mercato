import {
  computeHealthScore as genericComputeHealthScore,
  recencyScore,
  ratioScore,
  countScore,
  type HealthScoreConfig,
} from '@open-mercato/shared/lib/scoring/health-score'

// Re-export for BC
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// Keep individual scoring functions exported for direct use
export function computeActivityRecencyScore(daysSinceLastActivity: number | null): number {
  return recencyScore(daysSinceLastActivity)
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
  return ratioScore(actualOrdersInPeriod, expectedOrdersInPeriod)
}

export function computeInteractionCountScore(monthlyInteractions: number): number {
  return countScore(monthlyInteractions)
}

// CRM-specific health score config using the generic framework
const crmHealthConfig: HealthScoreConfig = {
  dimensions: [
    {
      name: 'activityRecency',
      weight: 0.30,
      compute: (params) => recencyScore(params.daysSinceLastActivity),
    },
    {
      name: 'dealPipelineHealth',
      weight: 0.25,
      compute: (params) => {
        const total = params.totalOpenDeals ?? 0
        if (total === 0) return 50
        const advancing = params.advancingDeals ?? 0
        const stalled = params.stalledDeals ?? 0
        const advancingRatio = advancing / total
        const stalledRatio = stalled / total
        return clamp(Math.round((advancingRatio * 100) - (stalledRatio * 50)), 0, 100)
      },
    },
    {
      name: 'orderFrequency',
      weight: 0.25,
      compute: (params) => ratioScore(params.actualOrdersInPeriod ?? 0, params.expectedOrdersInPeriod ?? 0),
    },
    {
      name: 'interactionCount',
      weight: 0.20,
      compute: (params) => countScore(params.monthlyInteractions ?? 0),
    },
  ],
  labelThresholds: {
    excellent: 80,
    good: 60,
    at_risk: 40,
  },
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
  const genericParams: Record<string, number | null> = {
    daysSinceLastActivity: params.daysSinceLastActivity,
    advancingDeals: params.advancingDeals,
    stalledDeals: params.stalledDeals,
    totalOpenDeals: params.totalOpenDeals,
    actualOrdersInPeriod: params.actualOrdersInPeriod,
    expectedOrdersInPeriod: params.expectedOrdersInPeriod,
    monthlyInteractions: params.monthlyInteractions,
  }

  const result = genericComputeHealthScore(crmHealthConfig, genericParams)

  // Map to CRM-specific result shape for BC
  const dimMap = new Map(result.dimensions.map((d) => [d.name, d.score]))

  return {
    score: result.score,
    label: result.label as HealthLabel,
    components: {
      activityRecency: dimMap.get('activityRecency') ?? 0,
      dealPipelineHealth: dimMap.get('dealPipelineHealth') ?? 0,
      orderFrequency: dimMap.get('orderFrequency') ?? 0,
      interactionCount: dimMap.get('interactionCount') ?? 0,
    },
  }
}
