import type { DateRangePreset } from '@open-mercato/ui/backend/date-range'
import type { WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import type { WidgetDataResponse } from '../services/widgetDataService'

export type MetricTrend = {
  current: number | null
  previous: number | null
  change: number | null
  direction: 'up' | 'down' | 'unchanged'
}

export type BusinessMetrics = {
  revenue?: MetricTrend
  orders?: MetricTrend
  averageOrderValue?: MetricTrend
  newCustomers?: MetricTrend
}

export type HealthScoreStatus = 'healthy' | 'watch' | 'critical'

export type MetricScoreBreakdown = {
  metricKey: keyof BusinessMetrics
  weight: number
  earnedScore: number
  change: number | null
}

export type HealthScoreResult = {
  score: number
  status: HealthScoreStatus
  summary: string
  breakdown: MetricScoreBreakdown[]
}

export type AttentionSeverity = 'critical' | 'warning' | 'positive'

export type AttentionItem = {
  id: string
  severity: AttentionSeverity
  title: string
  description: string
  metricKey: keyof BusinessMetrics
  priority: number
}

export type ExecutiveBriefResult = {
  headline: string
  status: HealthScoreStatus
  narrative: string
  keyTakeaways: string[]
}

/**
 * Weights assigned to each metric in the composite Business Health Score.
 * - Revenue (35%): Fundamental indicator of top-line commercial health.
 * - Orders (25%): Volume and transaction velocity across the store/pipeline.
 * - AOV (20%): Basket quality, pricing power, and up-sell effectiveness.
 * - New Customers (20%): Pipeline growth, acquisition velocity, and future potential.
 * Total = 100%.
 */
export const HEALTH_SCORE_WEIGHTS: Record<keyof BusinessMetrics, number> = {
  revenue: 35,
  orders: 25,
  averageOrderValue: 20,
  newCustomers: 20,
}

/**
 * Deterministically evaluates a single metric trend into a 0..1 performance multiplier.
 * - 0% growth / flat (±2%): Base performance multiplier of 0.50 (neutral).
 * - >= +20% growth: 1.00 (maximum performance multiplier).
 * - <= -20% decline: 0.00 (minimum performance multiplier).
 * - Intermediate positive trends scale linearly between 0.50 and 1.00.
 * - Intermediate negative trends scale linearly between 0.50 and 0.00.
 * - Missing/null metrics default to neutral 0.50 multiplier to avoid false panics on unconfigured modules.
 */
export function calculateMetricPerformanceMultiplier(trend?: MetricTrend): number {
  if (!trend || trend.change === null || Number.isNaN(trend.change)) {
    return 0.5
  }

  const change = trend.change

  // ±2% is considered stable/neutral
  if (Math.abs(change) <= 2) {
    return 0.5
  }

  if (change > 2) {
    // Scales from 0.50 at +2% to 1.00 at >= +20%
    const normalized = Math.min(1, (change - 2) / 18)
    return 0.5 + normalized * 0.5
  }

  // change < -2
  // Scales from 0.50 at -2% down to 0.00 at <= -20%
  const normalizedDrop = Math.min(1, Math.abs(change + 2) / 18)
  return Math.max(0, 0.5 - normalizedDrop * 0.5)
}

/**
 * Calculates a composite Business Health Score (0–100) based on weighted metric trends.
 * Thresholds:
 * - >= 70: Healthy
 * - 40 - 69: Watch
 * - < 40: Critical
 */
export function calculateHealthScore(metrics: BusinessMetrics): HealthScoreResult {
  const metricKeys: (keyof BusinessMetrics)[] = ['revenue', 'orders', 'averageOrderValue', 'newCustomers']
  const breakdown: MetricScoreBreakdown[] = []
  let totalScore = 0

  for (const key of metricKeys) {
    const weight = HEALTH_SCORE_WEIGHTS[key]
    const trend = metrics[key]
    const multiplier = calculateMetricPerformanceMultiplier(trend)
    const earnedScore = Math.round(weight * multiplier * 10) / 10

    totalScore += earnedScore
    breakdown.push({
      metricKey: key,
      weight,
      earnedScore,
      change: trend?.change ?? null,
    })
  }

  const roundedScore = Math.min(100, Math.max(0, Math.round(totalScore)))

  let status: HealthScoreStatus = 'watch'
  if (roundedScore >= 70) {
    status = 'healthy'
  } else if (roundedScore < 40) {
    status = 'critical'
  }

  // Factual, deterministic summary generation
  const summary = generateHealthScoreSummary(status, metrics)

  return {
    score: roundedScore,
    status,
    summary,
    breakdown,
  }
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'N/A'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function generateHealthScoreSummary(status: HealthScoreStatus, metrics: BusinessMetrics): string {
  const changes: { name: string; change: number }[] = []
  if (metrics.revenue?.change != null) changes.push({ name: 'Revenue', change: metrics.revenue.change })
  if (metrics.orders?.change != null) changes.push({ name: 'Orders', change: metrics.orders.change })
  if (metrics.averageOrderValue?.change != null) changes.push({ name: 'AOV', change: metrics.averageOrderValue.change })
  if (metrics.newCustomers?.change != null) changes.push({ name: 'New customers', change: metrics.newCustomers.change })

  if (changes.length === 0) {
    return 'Insufficient comparison data to determine trend trajectory.'
  }

  // Sort by change descending
  changes.sort((a, b) => b.change - a.change)
  const best = changes[0]
  const worst = changes[changes.length - 1]

  if (status === 'healthy') {
    if (best.change > 0) {
      return `Solid business performance driven by ${best.name} growth (${formatPercent(best.change)}).`
    }
    return 'Business metrics are stable across all core tracking indicators.'
  }

  if (status === 'critical') {
    return `Critical performance alert: ${worst.name} experienced significant decline (${formatPercent(worst.change)}).`
  }

  // 'watch' status
  if (worst.change < -5) {
    return `Performance requires monitoring: ${worst.name} is down (${formatPercent(worst.change)}).`
  }
  return 'Performance is holding within moderate variance bands across key metrics.'
}

/**
 * Identifies high-priority operational items requiring attention based on deterministic business rules.
 * Sorted by severity (critical first, then warning, then positive).
 */
export function identifyAttentionItems(metrics: BusinessMetrics): AttentionItem[] {
  const items: AttentionItem[] = []

  const rev = metrics.revenue?.change
  const ord = metrics.orders?.change
  const aov = metrics.averageOrderValue?.change
  const cust = metrics.newCustomers?.change

  // Rule 1: Significant Revenue Decline (Critical if >= 10%, Warning if >= 5%)
  if (rev != null) {
    if (rev <= -10) {
      items.push({
        id: 'rev-drop-critical',
        severity: 'critical',
        metricKey: 'revenue',
        title: 'Significant Revenue Contraction',
        description: `Revenue decreased by ${Math.abs(rev).toFixed(1)}% compared with the previous period.`,
        priority: 1,
      })
    } else if (rev <= -5) {
      items.push({
        id: 'rev-drop-warning',
        severity: 'warning',
        metricKey: 'revenue',
        title: 'Revenue Softening',
        description: `Revenue decreased by ${Math.abs(rev).toFixed(1)}% compared with the previous period.`,
        priority: 10,
      })
    }
  }

  // Rule 2: Significant Order Volume Decline (Critical if >= 15%, Warning if >= 5%)
  if (ord != null) {
    if (ord <= -15) {
      items.push({
        id: 'ord-drop-critical',
        severity: 'critical',
        metricKey: 'orders',
        title: 'Severe Order Volume Drop',
        description: `Order count dropped by ${Math.abs(ord).toFixed(1)}% compared with the previous period.`,
        priority: 2,
      })
    } else if (ord <= -5) {
      items.push({
        id: 'ord-drop-warning',
        severity: 'warning',
        metricKey: 'orders',
        title: 'Order Volume Contraction',
        description: `Order count decreased by ${Math.abs(ord).toFixed(1)}% compared with the previous period.`,
        priority: 11,
      })
    }
  }

  // Rule 3: Average Order Value Contraction
  if (aov != null && aov <= -8) {
    items.push({
      id: 'aov-drop-warning',
      severity: 'warning',
      metricKey: 'averageOrderValue',
      title: 'Average Order Value Decline',
      description: `Average order value dropped by ${Math.abs(aov).toFixed(1)}% compared with the previous period.`,
      priority: 12,
    })
  }

  // Rule 4: New Customer Acquisition Contraction
  if (cust != null && cust <= -10) {
    items.push({
      id: 'cust-drop-warning',
      severity: 'warning',
      metricKey: 'newCustomers',
      title: 'Customer Acquisition Slowdown',
      description: `New customer acquisition declined by ${Math.abs(cust).toFixed(1)}% compared with the previous period.`,
      priority: 13,
    })
  }

  // Rule 5: Volume vs Customer Divergence (Customers growing, but orders declining)
  if (cust != null && ord != null && cust >= 10 && ord < 0) {
    items.push({
      id: 'volume-divergence-warning',
      severity: 'warning',
      metricKey: 'orders',
      title: 'Order Volume Trailing Customer Growth',
      description: `New customer growth is positive (+${cust.toFixed(1)}%), but order volume decreased (${ord.toFixed(1)}%).`,
      priority: 14,
    })
  }

  // Rule 6: Strong Positive Growth Signals
  if (rev != null && rev >= 15) {
    items.push({
      id: 'rev-growth-positive',
      severity: 'positive',
      metricKey: 'revenue',
      title: 'Strong Revenue Expansion',
      description: `Revenue increased by ${rev.toFixed(1)}% compared with the previous period.`,
      priority: 20,
    })
  }

  if (cust != null && cust >= 20) {
    items.push({
      id: 'cust-growth-positive',
      severity: 'positive',
      metricKey: 'newCustomers',
      title: 'Accelerated Customer Growth',
      description: `New customer acquisition increased by ${cust.toFixed(1)}% compared with the previous period.`,
      priority: 21,
    })
  }

  if (ord != null && ord >= 15 && (rev == null || rev >= 0)) {
    items.push({
      id: 'ord-growth-positive',
      severity: 'positive',
      metricKey: 'orders',
      title: 'Robust Order Volume Growth',
      description: `Order volume grew by ${ord.toFixed(1)}% compared with the previous period.`,
      priority: 22,
    })
  }

  // Sort primarily by priority (lowest numeric rank = highest urgency)
  return items.sort((a, b) => a.priority - b.priority)
}

/**
 * Generates an executive-level summary deterministically from business metrics.
 * Strictly adheres to empirical data without fabricated claims or speculation.
 */
export function generateExecutiveBrief(metrics: BusinessMetrics): ExecutiveBriefResult {
  const health = calculateHealthScore(metrics)
  const takeaways: string[] = []

  // Metric points
  if (metrics.revenue?.change != null) {
    const dir = metrics.revenue.change >= 0 ? 'increased' : 'decreased'
    takeaways.push(`Revenue ${dir} ${Math.abs(metrics.revenue.change).toFixed(1)}% compared with the previous period.`)
  }

  if (metrics.orders?.change != null) {
    const dir = metrics.orders.change >= 0 ? 'increased' : 'decreased'
    takeaways.push(`Order count ${dir} ${Math.abs(metrics.orders.change).toFixed(1)}% compared with the previous period.`)
  }

  if (metrics.averageOrderValue?.change != null) {
    const dir = metrics.averageOrderValue.change >= 0 ? 'increased' : 'decreased'
    takeaways.push(`Average order value ${dir} ${Math.abs(metrics.averageOrderValue.change).toFixed(1)}% compared with the previous period.`)
  }

  if (metrics.newCustomers?.change != null) {
    const dir = metrics.newCustomers.change >= 0 ? 'increased' : 'decreased'
    takeaways.push(`New customer acquisition ${dir} ${Math.abs(metrics.newCustomers.change).toFixed(1)}% compared with the previous period.`)
  }

  // Headline
  let headline = 'Business Performance Stable'
  if (health.status === 'healthy') {
    headline = 'Business Performance Healthy'
  } else if (health.status === 'critical') {
    headline = 'Business Performance Requires Urgent Attention'
  } else if (health.status === 'watch') {
    headline = 'Business Performance Under Watch'
  }

  // Narrative generation
  let narrative = ''
  if (takeaways.length === 0) {
    narrative = 'Insufficient comparative metrics available for the selected period to generate an executive brief.'
  } else {
    const parts: string[] = []
    parts.push(`Overall business performance is evaluated as ${health.status}.`)

    if (metrics.revenue?.change != null && metrics.newCustomers?.change != null) {
      const revDir = metrics.revenue.change >= 0 ? 'increased' : 'decreased'
      const custDir = metrics.newCustomers.change >= 0 ? 'increased' : 'decreased'
      parts.push(
        `Revenue ${revDir} ${Math.abs(metrics.revenue.change).toFixed(1)}% and customer growth ${custDir} ${Math.abs(metrics.newCustomers.change).toFixed(1)}% compared with the previous period.`
      )
    } else if (metrics.revenue?.change != null) {
      const revDir = metrics.revenue.change >= 0 ? 'increased' : 'decreased'
      parts.push(`Revenue ${revDir} ${Math.abs(metrics.revenue.change).toFixed(1)}% compared with the previous period.`)
    }

    // Divergence / anomaly note
    if (metrics.orders?.change != null && metrics.newCustomers?.change != null) {
      if (metrics.newCustomers.change > 5 && metrics.orders.change < metrics.newCustomers.change - 5) {
        parts.push('Order growth is trailing customer growth and should be monitored.')
      } else if (metrics.orders.change > 5 && metrics.newCustomers.change <= 0) {
        parts.push('Order volume growth is outpacing customer acquisition.')
      }
    }

    if (health.status === 'critical') {
      parts.push('Multiple performance indicators are contracting significantly.')
    }

    narrative = parts.join(' ')
  }

  return {
    headline,
    status: health.status,
    narrative,
    keyTakeaways: takeaways,
  }
}

/**
 * Shared fetcher that retrieves the 4 foundational metrics concurrently through Open Mercato's
 * batched widget data aggregation API.
 */
export async function fetchBusinessIntelligenceMetrics(
  settings: { dateRange: DateRangePreset; showComparison: boolean },
  fetchWidgetData: WidgetDataFetcher,
): Promise<BusinessMetrics> {
  const comparison = settings.showComparison ? { type: 'previous_period' as const } : undefined

  const [revRes, ordRes, aovRes, custRes] = await Promise.allSettled([
    fetchWidgetData<WidgetDataResponse>({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
      dateRange: { field: 'placedAt', preset: settings.dateRange },
      comparison,
    }),
    fetchWidgetData<WidgetDataResponse>({
      entityType: 'sales:orders',
      metric: { field: 'id', aggregate: 'count' },
      dateRange: { field: 'placedAt', preset: settings.dateRange },
      comparison,
    }),
    fetchWidgetData<WidgetDataResponse>({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'avg' },
      dateRange: { field: 'placedAt', preset: settings.dateRange },
      comparison,
    }),
    fetchWidgetData<WidgetDataResponse>({
      entityType: 'customers:entities',
      metric: { field: 'id', aggregate: 'count' },
      dateRange: { field: 'createdAt', preset: settings.dateRange },
      comparison,
    }),
  ])

  const mapResponse = (res: PromiseSettledResult<WidgetDataResponse>): MetricTrend | undefined => {
    if (res.status !== 'fulfilled' || !res.value) return undefined
    const val = res.value
    return {
      current: val.value,
      previous: val.comparison?.value ?? null,
      change: val.comparison?.change ?? null,
      direction: val.comparison?.direction ?? 'unchanged',
    }
  }

  return {
    revenue: mapResponse(revRes),
    orders: mapResponse(ordRes),
    averageOrderValue: mapResponse(aovRes),
    newCustomers: mapResponse(custRes),
  }
}
