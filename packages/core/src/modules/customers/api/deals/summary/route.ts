import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { ExchangeRateService, RateResult } from '@open-mercato/core/modules/currencies/services/exchangeRateService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveDealsOrganizationIds } from '../../../lib/dealsOrganizationScope'
import { resolveOptionalBaseCurrencyCode } from '../../../lib/optionalBaseCurrency'
import { loadDealsSummaryQueryRows } from '../../../lib/dealsSummaryQueries'
import {
  computeDelta,
  convertSumsToBase,
  getPreviousQuarterWindow,
  getPreviousTrailingWindow,
  getQuarterWindow,
  getTrailingWindow,
  getTrailingMonths,
  type CurrencySum,
  type Delta,
} from '../../../lib/dealsMetrics'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

const TOP_OWNERS = 5

const deltaSchema = z.object({
  value: z.number(),
  direction: z.enum(['up', 'down', 'unchanged']),
})

const stageBreakdownSchema = z.object({
  stage: z.string().nullable(),
  count: z.number(),
  value: z.number(),
})

const ownerCountSchema = z.object({
  id: z.string(),
  count: z.number(),
})

const winRatePointSchema = z.object({
  period: z.string(),
  rate: z.number(),
})

const monthlyValuePointSchema = z.object({
  period: z.string(),
  value: z.number(),
})

const monthlyCountPointSchema = z.object({
  period: z.string(),
  count: z.number(),
})

const SUMMARY_RANGES = ['quarter', '3m', '6m', '12m'] as const
const summaryRangeSchema = z.enum(SUMMARY_RANGES)
type SummaryRange = z.infer<typeof summaryRangeSchema>
const DEFAULT_SUMMARY_RANGE: SummaryRange = 'quarter'
const QUARTER_SERIES_MONTHS = 6
const TRAILING_RANGE_MONTHS: Record<Exclude<SummaryRange, 'quarter'>, number> = { '3m': 3, '6m': 6, '12m': 12 }

const summaryResponseSchema = z.object({
  range: summaryRangeSchema,
  baseCurrencyCode: z.string().nullable(),
  convertedAll: z.boolean(),
  missingRateCurrencies: z.array(z.string()),
  pipelineValue: z.object({
    value: z.number(),
    delta: deltaSchema,
    stages: z.array(stageBreakdownSchema),
    series: z.array(monthlyValuePointSchema),
  }),
  activeDeals: z.object({
    value: z.number(),
    delta: deltaSchema,
    series: z.array(monthlyCountPointSchema),
    ownersCount: z.number(),
    needAttention: z.number(),
    owners: z.array(ownerCountSchema),
    ownersOverflow: z.number(),
  }),
  wonThisQuarter: z.object({
    value: z.number(),
    delta: deltaSchema,
    series: z.array(monthlyValuePointSchema),
    dealsClosed: z.number(),
    avgDeal: z.number(),
  }),
  winRate: z.object({
    value: z.number(),
    deltaPp: z.number(),
    direction: z.enum(['up', 'down', 'unchanged']),
    previousValue: z.number(),
    series: z.array(winRatePointSchema),
  }),
})

export type DealsSummaryResponse = z.infer<typeof summaryResponseSchema>

const summaryErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deals KPI summary',
  methods: {
    GET: {
      summary: 'Pipeline KPI metrics with period-over-period deltas for the deals list',
      description:
        'Returns the four list-level KPI metrics (pipeline value, active deals, won, win rate) for the window selected with `?range=quarter|3m|6m|12m`. `quarter` (the default, also used for an absent or unknown value) compares the current calendar quarter with the previous one and returns 6 trailing months in the series; `3m`, `6m` and `12m` compare the trailing window with the one before it and return one series point per month of that window. Also returns the per-stage open-pipeline breakdown, top owners and monthly series (value and count of deals created, won value, win rate). Values are converted to the tenant base currency where rates are available; partial conversions are disclosed via convertedAll/missingRateCurrencies.',
      responses: [
        { status: 200, description: 'Deals KPI summary payload', schema: summaryResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: summaryErrorSchema },
      ],
    },
  },
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function winRate(won: number, lost: number): number {
  const denom = won + lost
  if (denom <= 0) return 0
  return Math.round((100 * won) / denom)
}

function sumsByCurrency(entries: Array<{ currency: string | null; total: number }>): CurrencySum[] {
  const byCurrency = new Map<string, number>()
  for (const entry of entries) {
    const currency = (entry.currency ?? '').toString().trim().toUpperCase()
    if (!currency) continue
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + entry.total)
  }
  return Array.from(byCurrency.entries()).map(([currency, total]) => ({ currency, total }))
}

function resolveSummaryWindows(range: SummaryRange, now: Date) {
  if (range === 'quarter') {
    return {
      current: getQuarterWindow(now),
      previous: getPreviousQuarterWindow(now),
      trailingMonths: getTrailingMonths(now, QUARTER_SERIES_MONTHS),
    }
  }
  const months = TRAILING_RANGE_MONTHS[range]
  return {
    current: getTrailingWindow(now, months),
    previous: getPreviousTrailingWindow(now, months),
    trailingMonths: getTrailingMonths(now, months),
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<CoreEntityManager>('em')

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const effectiveTenantId = scope.tenantId ?? auth.tenantId
  if (!effectiveTenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const orgFilterIds = await resolveDealsOrganizationIds({ em, scope, auth, tenantId: effectiveTenantId })

  const rangeParam = summaryRangeSchema.safeParse(new URL(req.url).searchParams.get('range'))
  const range = rangeParam.success ? rangeParam.data : DEFAULT_SUMMARY_RANGE
  const today = new Date()
  // Headline numbers compare the selected window with the one before it. A trailing range's
  // series cover the same window month by month; the quarter range keeps its 6-month series.
  const { current: currentQuarter, previous: previousQuarter, trailingMonths } = resolveSummaryWindows(range, today)
  const seriesStart = trailingMonths[0]?.start ?? currentQuarter.start

  const baseCurrencyCode = await resolveOptionalBaseCurrencyCode(
    container,
    effectiveTenantId,
    orgFilterIds[0],
  )

  const { openRows, inflowRows, wonRows, winLossRows, seriesRows, inflowSeriesRows, wonSeriesRows, overdueRows, openStuckIds } =
    await loadDealsSummaryQueryRows({
      em,
      tenantId: effectiveTenantId,
      organizationIds: orgFilterIds,
      currentQuarter,
      previousQuarter,
      seriesStart,
    })

  const attentionIds = new Set<string>()
  for (const row of overdueRows) attentionIds.add(row.id)
  for (const id of openStuckIds) attentionIds.add(id)

  // Reduce open rows: per-stage sums, distinct owners, owner counts, and a flat
  // per-currency list for the converted pipeline total.
  const stageMap = new Map<string, { stage: string | null; count: number; byCurrency: CurrencySum[] }>()
  const openOwnerCounts = new Map<string, number>()
  const openSums: Array<{ currency: string | null; total: number }> = []
  for (const row of openRows) {
    const stageKey = row.stage ?? '__null__'
    const total = toNumber(row.total)
    const count = toNumber(row.count)
    const currency = (row.currency ?? '').toString().trim().toUpperCase()
    if (!stageMap.has(stageKey)) {
      stageMap.set(stageKey, { stage: row.stage ?? null, count: 0, byCurrency: [] })
    }
    const stageAgg = stageMap.get(stageKey)!
    stageAgg.count += count
    if (currency) stageAgg.byCurrency.push({ currency, total })
    openSums.push({ currency, total })
    if (row.owner_user_id) {
      openOwnerCounts.set(row.owner_user_id, (openOwnerCounts.get(row.owner_user_id) ?? 0) + count)
    }
  }

  // Collect every distinct non-base currency across all metrics and fetch rates ONCE.
  const distinctCurrencies = new Set<string>()
  const collect = (entries: Array<{ currency: string | null }>) => {
    for (const entry of entries) {
      const currency = (entry.currency ?? '').toString().trim().toUpperCase()
      if (currency && currency !== baseCurrencyCode) distinctCurrencies.add(currency)
    }
  }
  collect(openSums)
  collect(inflowRows)
  collect(wonRows)
  collect(inflowSeriesRows)
  collect(wonSeriesRows)

  let rates = new Map<string, RateResult>()
  if (baseCurrencyCode && distinctCurrencies.size > 0) {
    const exchange = container.resolve('exchangeRateService') as ExchangeRateService | undefined
    if (exchange) {
      const pairs = Array.from(distinctCurrencies).map((code) => ({
        fromCurrencyCode: code,
        toCurrencyCode: baseCurrencyCode,
      }))
      try {
        rates = await exchange.getRates({
          pairs,
          date: today,
          scope: { tenantId: effectiveTenantId, organizationId: orgFilterIds[0] },
          options: { maxDaysBack: 60, autoFetch: false },
        })
      } catch (err) {
        logger.warn('exchange-rate lookup failed; falling back to per-currency totals', { component: 'deals.summary', err })
      }
    }
  }

  const missingRateCurrencies = new Set<string>()
  const trackMissing = (missing: string[]) => {
    for (const code of missing) missingRateCurrencies.add(code)
  }
  let convertedAll = true

  // Degraded path: when there is no base currency, fall back to the dominant currency's
  // raw sum so the cards still show a number (mirrors the aggregate route's disclosure).
  const dominantCurrencyTotal = (entries: Array<{ currency: string | null; total: number }>): number => {
    const byCurrency = new Map<string, number>()
    for (const entry of entries) {
      const currency = (entry.currency ?? '').toString().trim().toUpperCase()
      if (!currency) continue
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + entry.total)
    }
    let best = 0
    for (const total of byCurrency.values()) {
      if (Math.abs(total) > Math.abs(best)) best = total
    }
    return Math.round(best)
  }

  const convert = (entries: Array<{ currency: string | null; total: number }>): number => {
    if (!baseCurrencyCode) {
      convertedAll = false
      trackMissing(sumsByCurrency(entries).map((entry) => entry.currency))
      return dominantCurrencyTotal(entries)
    }
    const result = convertSumsToBase(sumsByCurrency(entries), baseCurrencyCode, rates)
    if (!result.convertedAll) convertedAll = false
    trackMissing(result.missingRateCurrencies)
    return result.total
  }

  // Pipeline value (open deals, converted) + per-stage converted breakdown.
  const pipelineValueTotal = convert(openSums)
  const stages = Array.from(stageMap.values()).map((stageAgg) => ({
    stage: stageAgg.stage,
    count: stageAgg.count,
    value: convert(stageAgg.byCurrency),
  }))

  // Pipeline inflow delta (open value created this vs previous quarter).
  const inflowCurrent = convert(inflowRows.map((row) => ({ currency: row.currency, total: toNumber(row.current_total) })))
  const inflowPrevious = convert(inflowRows.map((row) => ({ currency: row.currency, total: toNumber(row.previous_total) })))
  const pipelineDelta: Delta = computeDelta(inflowCurrent, inflowPrevious)

  // Active deals: count of open deals, owners, need-attention, top owners.
  const activeDealsCount = openRows.reduce((sum, row) => sum + toNumber(row.count), 0)
  const ownersCount = openOwnerCounts.size
  const inflowCurrentCount = inflowRows.reduce((sum, row) => sum + toNumber(row.current_count), 0)
  const inflowPreviousCount = inflowRows.reduce((sum, row) => sum + toNumber(row.previous_count), 0)
  const activeDelta: Delta = computeDelta(inflowCurrentCount, inflowPreviousCount)
  const sortedOwners = Array.from(openOwnerCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const owners = sortedOwners.slice(0, TOP_OWNERS).map(([id, count]) => ({ id, count }))
  const ownersOverflow = Math.max(0, ownersCount - owners.length)

  // Won this quarter.
  const wonCurrent = convert(wonRows.map((row) => ({ currency: row.currency, total: toNumber(row.current_total) })))
  const wonPrevious = convert(wonRows.map((row) => ({ currency: row.currency, total: toNumber(row.previous_total) })))
  const dealsClosed = wonRows.reduce((sum, row) => sum + toNumber(row.current_count), 0)
  const wonDelta: Delta = computeDelta(wonCurrent, wonPrevious)
  const avgDeal = dealsClosed > 0 ? Math.round(wonCurrent / dealsClosed) : 0

  // Win rate (current + previous quarter) and pp delta.
  const winLoss = winLossRows[0]
  const currentWon = toNumber(winLoss?.current_won)
  const currentLost = toNumber(winLoss?.current_lost)
  const previousWon = toNumber(winLoss?.previous_won)
  const previousLost = toNumber(winLoss?.previous_lost)
  const winRateValue = winRate(currentWon, currentLost)
  const winRatePrevious = winRate(previousWon, previousLost)
  const deltaPp = winRateValue - winRatePrevious
  const winRateDirection = deltaPp > 0 ? 'up' : deltaPp < 0 ? 'down' : 'unchanged'

  // Win-rate series over trailing months (fill missing months with 0).
  const seriesByPeriod = new Map<string, { won: number; lost: number }>()
  for (const row of seriesRows) {
    seriesByPeriod.set(row.period, { won: toNumber(row.won), lost: toNumber(row.lost) })
  }
  const series = trailingMonths.map((month) => {
    const point = seriesByPeriod.get(month.label)
    const won = point?.won ?? 0
    const lost = point?.lost ?? 0
    const denom = won + lost
    return { period: month.label, rate: denom > 0 ? won / denom : 0 }
  })

  // Monthly trends behind the metric tabs: value / count of all deals created per month
  // and won value per month, converted like the headline numbers.
  const monthlyBuckets = (rows: Array<{ period: string; currency: string | null; count: string | number; total: string | number | null }>) => {
    const byPeriod = new Map<string, { count: number; byCurrency: CurrencySum[] }>()
    for (const row of rows) {
      const bucket = byPeriod.get(row.period) ?? { count: 0, byCurrency: [] }
      bucket.count += toNumber(row.count)
      const currency = (row.currency ?? '').toString().trim().toUpperCase()
      if (currency) bucket.byCurrency.push({ currency, total: toNumber(row.total) })
      byPeriod.set(row.period, bucket)
    }
    return byPeriod
  }
  const inflowByPeriod = monthlyBuckets(inflowSeriesRows)
  const wonByPeriod = monthlyBuckets(wonSeriesRows)
  const pipelineSeries = trailingMonths.map((month) => ({
    period: month.label,
    value: convert(inflowByPeriod.get(month.label)?.byCurrency ?? []),
  }))
  const activeSeries = trailingMonths.map((month) => ({
    period: month.label,
    count: inflowByPeriod.get(month.label)?.count ?? 0,
  }))
  const wonSeries = trailingMonths.map((month) => ({
    period: month.label,
    value: convert(wonByPeriod.get(month.label)?.byCurrency ?? []),
  }))

  const response: DealsSummaryResponse = {
    range,
    baseCurrencyCode,
    convertedAll,
    missingRateCurrencies: Array.from(missingRateCurrencies),
    pipelineValue: {
      value: pipelineValueTotal,
      delta: pipelineDelta,
      stages,
      series: pipelineSeries,
    },
    activeDeals: {
      value: activeDealsCount,
      delta: activeDelta,
      series: activeSeries,
      ownersCount,
      needAttention: attentionIds.size,
      owners,
      ownersOverflow,
    },
    wonThisQuarter: {
      value: wonCurrent,
      delta: wonDelta,
      series: wonSeries,
      dealsClosed,
      avgDeal,
    },
    winRate: {
      value: winRateValue,
      deltaPp,
      direction: winRateDirection,
      previousValue: winRatePrevious,
      series,
    },
  }

  return NextResponse.json(response)
}
