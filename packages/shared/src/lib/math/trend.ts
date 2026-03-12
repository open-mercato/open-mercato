/**
 * Generic trend computation comparing recent vs previous period values.
 * Eliminates duplication between CRM metrics and purchase history routes.
 */

export type TrendDirection = 'growing' | 'declining' | 'stable'

/**
 * Compare two period values and determine the trend direction.
 *
 * @param recentValue - Value from the recent period
 * @param previousValue - Value from the previous period
 * @param growthThreshold - Ratio above which trend is "growing" (default: 1.1 = 10% growth)
 * @param declineThreshold - Ratio below which trend is "declining" (default: 0.9 = 10% decline)
 * @returns Trend direction
 */
export function computeTrend(
  recentValue: number,
  previousValue: number,
  growthThreshold: number = 1.1,
  declineThreshold: number = 0.9,
): TrendDirection {
  if (previousValue === 0 && recentValue === 0) return 'stable'
  if (previousValue === 0) return 'growing'
  const ratio = recentValue / previousValue
  if (ratio > growthThreshold) return 'growing'
  if (ratio < declineThreshold) return 'declining'
  return 'stable'
}
