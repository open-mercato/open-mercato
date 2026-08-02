import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'
import type { EntityManager as PgEntityManager } from '@mikro-orm/postgresql'
import { fetchStuckDealIds } from './stuckDeals'

type DateWindow = {
  start: Date
  end: Date
}

export type OpenPipelineRow = {
  stage: string | null
  currency: string | null
  total: string | number | null
  count: string | number
  owner_user_id: string | null
}

export type WindowSumRow = {
  currency: string | null
  current_total: string | number | null
  current_count: string | number
  previous_total: string | number | null
  previous_count: string | number
}

export type WinLossRow = {
  current_won: string | number
  current_lost: string | number
  previous_won: string | number
  previous_lost: string | number
}

export type WinRateMonthRow = {
  period: string
  won: string | number
  lost: string | number
}

export type DealsSummaryQueryRows = {
  openRows: OpenPipelineRow[]
  inflowRows: WindowSumRow[]
  wonRows: WindowSumRow[]
  winLossRows: WinLossRow[]
  seriesRows: WinRateMonthRow[]
  overdueRows: Array<{ id: string }>
  openStuckIds: string[]
}

export type DealsSummaryQueryInput = {
  em: CoreEntityManager
  tenantId: string
  organizationIds: string[]
  currentQuarter: DateWindow
  previousQuarter: DateWindow
  seriesStart: Date
}

type SqlPredicate = {
  clause: string
  values: string[]
}

export function buildOpenDealPredicate(statuses: readonly string[]): SqlPredicate {
  if (statuses.length === 0) {
    throw new Error('[internal] Open-deal predicate requires at least one status')
  }

  const placeholders = statuses.map(() => '?').join(',')
  return {
    clause: `status IN (${placeholders}) AND closure_outcome IS NULL`,
    values: [...statuses],
  }
}

export async function loadDealsSummaryQueryRows(input: DealsSummaryQueryInput): Promise<DealsSummaryQueryRows> {
  if (input.organizationIds.length === 0) {
    throw new Error('[internal] Deals summary query requires an organization scope')
  }

  const connection = input.em.getConnection()
  const organizationPlaceholders = input.organizationIds.map(() => '?').join(',')
  const scopeWhere = `tenant_id = ? AND organization_id IN (${organizationPlaceholders}) AND deleted_at IS NULL`
  const scopeValues: Array<string | number | null> = [input.tenantId, ...input.organizationIds]
  const openDealsPredicate = buildOpenDealPredicate(['open', 'in_progress'])

  const openRows = await connection.execute<OpenPipelineRow[]>(
    `SELECT
        pipeline_stage AS stage,
        UPPER(COALESCE(value_currency, '')) AS currency,
        COALESCE(SUM(value_amount), 0) AS total,
        COUNT(*) AS count,
        owner_user_id
      FROM customer_deals
      WHERE ${scopeWhere} AND ${openDealsPredicate.clause}
      GROUP BY pipeline_stage, UPPER(COALESCE(value_currency, '')), owner_user_id`,
    [...scopeValues, ...openDealsPredicate.values],
  )

  const inflowRows = await connection.execute<WindowSumRow[]>(
    `SELECT
        UPPER(COALESCE(value_currency, '')) AS currency,
        COALESCE(SUM(value_amount) FILTER (WHERE created_at >= ? AND created_at < ?), 0) AS current_total,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS current_count,
        COALESCE(SUM(value_amount) FILTER (WHERE created_at >= ? AND created_at < ?), 0) AS previous_total,
        COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS previous_count
      FROM customer_deals
      WHERE ${scopeWhere} AND ${openDealsPredicate.clause}
      GROUP BY UPPER(COALESCE(value_currency, ''))`,
    [
      input.currentQuarter.start.toISOString(),
      input.currentQuarter.end.toISOString(),
      input.currentQuarter.start.toISOString(),
      input.currentQuarter.end.toISOString(),
      input.previousQuarter.start.toISOString(),
      input.previousQuarter.end.toISOString(),
      input.previousQuarter.start.toISOString(),
      input.previousQuarter.end.toISOString(),
      ...scopeValues,
      ...openDealsPredicate.values,
    ],
  )

  const wonRows = await connection.execute<WindowSumRow[]>(
    `SELECT
        UPPER(COALESCE(value_currency, '')) AS currency,
        COALESCE(SUM(value_amount) FILTER (WHERE updated_at >= ? AND updated_at < ?), 0) AS current_total,
        COUNT(*) FILTER (WHERE updated_at >= ? AND updated_at < ?) AS current_count,
        COALESCE(SUM(value_amount) FILTER (WHERE updated_at >= ? AND updated_at < ?), 0) AS previous_total,
        COUNT(*) FILTER (WHERE updated_at >= ? AND updated_at < ?) AS previous_count
      FROM customer_deals
      WHERE ${scopeWhere} AND (status = 'win' OR closure_outcome = 'won')
      GROUP BY UPPER(COALESCE(value_currency, ''))`,
    [
      input.currentQuarter.start.toISOString(),
      input.currentQuarter.end.toISOString(),
      input.currentQuarter.start.toISOString(),
      input.currentQuarter.end.toISOString(),
      input.previousQuarter.start.toISOString(),
      input.previousQuarter.end.toISOString(),
      input.previousQuarter.start.toISOString(),
      input.previousQuarter.end.toISOString(),
      ...scopeValues,
    ],
  )

  const winLossRows = await connection.execute<WinLossRow[]>(
    `SELECT
        COUNT(*) FILTER (WHERE (status = 'win' OR closure_outcome = 'won') AND updated_at >= ? AND updated_at < ?) AS current_won,
        COUNT(*) FILTER (WHERE (status = 'loose' OR closure_outcome = 'lost') AND updated_at >= ? AND updated_at < ?) AS current_lost,
        COUNT(*) FILTER (WHERE (status = 'win' OR closure_outcome = 'won') AND updated_at >= ? AND updated_at < ?) AS previous_won,
        COUNT(*) FILTER (WHERE (status = 'loose' OR closure_outcome = 'lost') AND updated_at >= ? AND updated_at < ?) AS previous_lost
      FROM customer_deals
      WHERE ${scopeWhere}`,
    [
      input.currentQuarter.start.toISOString(),
      input.currentQuarter.end.toISOString(),
      input.currentQuarter.start.toISOString(),
      input.currentQuarter.end.toISOString(),
      input.previousQuarter.start.toISOString(),
      input.previousQuarter.end.toISOString(),
      input.previousQuarter.start.toISOString(),
      input.previousQuarter.end.toISOString(),
      ...scopeValues,
    ],
  )

  const seriesRows = await connection.execute<WinRateMonthRow[]>(
    `SELECT
        to_char(date_trunc('month', updated_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS period,
        COUNT(*) FILTER (WHERE status = 'win' OR closure_outcome = 'won') AS won,
        COUNT(*) FILTER (WHERE status = 'loose' OR closure_outcome = 'lost') AS lost
      FROM customer_deals
      WHERE ${scopeWhere} AND updated_at >= ?
      GROUP BY 1`,
    [...scopeValues, input.seriesStart.toISOString()],
  )

  const overdueDealsPredicate = buildOpenDealPredicate(['open'])
  const overdueRows = await connection.execute<Array<{ id: string }>>(
    `SELECT id FROM customer_deals
      WHERE ${scopeWhere} AND ${overdueDealsPredicate.clause} AND expected_close_at IS NOT NULL AND expected_close_at < CURRENT_DATE`,
    [...scopeValues, ...overdueDealsPredicate.values],
  )

  const stuckIdLists = await Promise.all(
    input.organizationIds.map((organizationId) =>
      fetchStuckDealIds(input.em as unknown as PgEntityManager, organizationId, input.tenantId),
    ),
  )
  const stuckIdValues = Array.from(new Set(stuckIdLists.flat()))
  let openStuckIds: string[] = []
  if (stuckIdValues.length > 0) {
    const stuckPlaceholders = stuckIdValues.map(() => '?').join(',')
    const openStuckRows: Array<{ id: string }> = await connection.execute<Array<{ id: string }>>(
      `SELECT id FROM customer_deals
        WHERE ${scopeWhere} AND ${openDealsPredicate.clause} AND id IN (${stuckPlaceholders})`,
      [...scopeValues, ...openDealsPredicate.values, ...stuckIdValues],
    )
    openStuckIds = openStuckRows.map((row) => row.id)
  }

  return {
    openRows,
    inflowRows,
    wonRows,
    winLossRows,
    seriesRows,
    overdueRows,
    openStuckIds,
  }
}
