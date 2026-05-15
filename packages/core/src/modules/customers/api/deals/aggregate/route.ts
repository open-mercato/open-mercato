import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'
import type { EntityManager as PgEntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ExchangeRateService } from '@open-mercato/core/modules/currencies/services/exchangeRateService'
import { fetchStuckDealIds } from '../../../lib/stuckDeals'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

const querySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  status: z.array(z.enum(['open', 'closed', 'win', 'loose'])).optional(),
  ownerUserId: z.array(z.string().uuid()).optional(),
  personId: z.array(z.string().uuid()).optional(),
  companyId: z.array(z.string().uuid()).optional(),
  isStuck: z.coerce.boolean().optional(),
  isOverdue: z.coerce.boolean().optional(),
  expectedCloseAtFrom: z.string().optional(),
  expectedCloseAtTo: z.string().optional(),
})

type StageBreakdownByCurrency = {
  currency: string
  total: number
  count: number
}

type StageAggregate = {
  stageId: string
  count: number
  openCount: number
  totalInBaseCurrency: number
  byCurrency: StageBreakdownByCurrency[]
  /**
   * `true` when every currency present in `byCurrency` was either the base currency or
   * had a usable exchange rate at request time. `false` when at least one currency in
   * `byCurrency` could not be resolved to base — the lane header should surface a
   * "partial" indicator in that case so the converted total isn't read as authoritative.
   */
  convertedAll: boolean
  /**
   * Currencies present in `byCurrency` that had NO exchange rate to the base currency.
   * Empty when conversion was complete or there is no base currency configured. The
   * client uses this to disclose which slice of the value is excluded from `totalInBaseCurrency`.
   */
  missingRateCurrencies: string[]
}

type AggregateResponse = {
  baseCurrencyCode: string | null
  perStage: StageAggregate[]
}

export const openApi = {
  tags: ['Customers'],
  summary: 'Deals aggregate per pipeline stage',
  description:
    'Returns per-stage counts and totals for deals, with values converted to the tenant base currency where rates are available. Used to power kanban lane headers without loading every deal.',
}

function readArrayParam(searchParams: URLSearchParams, key: string): string[] | null {
  const all = searchParams.getAll(key)
  if (!all.length) return null
  const flat = all.flatMap((v) => v.split(','))
  const trimmed = flat.map((s) => s.trim()).filter(Boolean)
  return trimmed.length ? trimmed : null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const params = url.searchParams
  const parsed = querySchema.safeParse({
    pipelineId: params.get('pipelineId') ?? undefined,
    status: readArrayParam(params, 'status') ?? undefined,
    ownerUserId: readArrayParam(params, 'ownerUserId') ?? undefined,
    personId: readArrayParam(params, 'personId') ?? undefined,
    companyId: readArrayParam(params, 'companyId') ?? undefined,
    isStuck: params.get('isStuck') ?? undefined,
    isOverdue: params.get('isOverdue') ?? undefined,
    expectedCloseAtFrom: params.get('expectedCloseAtFrom') ?? undefined,
    expectedCloseAtTo: params.get('expectedCloseAtTo') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<CoreEntityManager>('em')

  // Find the tenant's base currency. Falls back to `null` if none flagged.
  const baseCurrency = await em.getConnection().execute<Array<{ code: string }>>(
    `SELECT code FROM currencies WHERE tenant_id = ? AND organization_id = ? AND is_base = true AND deleted_at IS NULL LIMIT 1`,
    [auth.tenantId, auth.orgId],
  )
  const baseCurrencyCode = baseCurrency[0]?.code ?? null

  // Build WHERE clause shared between count + sum queries
  const where: string[] = [
    'tenant_id = ?',
    'organization_id = ?',
    'deleted_at IS NULL',
  ]
  const values: Array<string | number | null> = [auth.tenantId, auth.orgId]

  if (parsed.data.pipelineId) {
    where.push('pipeline_id = ?')
    values.push(parsed.data.pipelineId)
  }
  if (parsed.data.status && parsed.data.status.length) {
    const placeholders = parsed.data.status.map(() => '?').join(',')
    where.push(`status IN (${placeholders})`)
    values.push(...parsed.data.status)
  }
  if (parsed.data.ownerUserId && parsed.data.ownerUserId.length) {
    const placeholders = parsed.data.ownerUserId.map(() => '?').join(',')
    where.push(`owner_user_id IN (${placeholders})`)
    values.push(...parsed.data.ownerUserId)
  }
  if (parsed.data.expectedCloseAtFrom) {
    where.push('expected_close_at >= ?')
    values.push(parsed.data.expectedCloseAtFrom)
  }
  if (parsed.data.expectedCloseAtTo) {
    where.push('expected_close_at <= ?')
    values.push(parsed.data.expectedCloseAtTo)
  }
  if (parsed.data.isOverdue) {
    where.push("expected_close_at < CURRENT_DATE AND status = 'open'")
  }
  if (parsed.data.isStuck) {
    // Reuse the list endpoint's stuck-deal lookup so kanban headers, lane counts, and the
    // cards rendered inside each lane agree on the same definition of "stuck". Empty result
    // → narrow to a sentinel UUID so the WHERE clause collapses to zero rows.
    const stuckIds = await fetchStuckDealIds(em as unknown as PgEntityManager, auth.orgId, auth.tenantId)
    if (stuckIds.length === 0) {
      where.push('id = ?')
      values.push('00000000-0000-0000-0000-000000000000')
    } else {
      const placeholders = stuckIds.map(() => '?').join(',')
      where.push(`id IN (${placeholders})`)
      values.push(...stuckIds)
    }
  }
  if (parsed.data.personId && parsed.data.personId.length) {
    const placeholders = parsed.data.personId.map(() => '?').join(',')
    where.push(`EXISTS (SELECT 1 FROM customer_deal_people dp WHERE dp.deal_id = customer_deals.id AND dp.person_entity_id IN (${placeholders}))`)
    values.push(...parsed.data.personId)
  }
  if (parsed.data.companyId && parsed.data.companyId.length) {
    const placeholders = parsed.data.companyId.map(() => '?').join(',')
    where.push(`EXISTS (SELECT 1 FROM customer_deal_companies dc WHERE dc.deal_id = customer_deals.id AND dc.company_entity_id IN (${placeholders}))`)
    values.push(...parsed.data.companyId)
  }

  const whereSql = where.join(' AND ')

  // Aggregate by (stage, currency). Treat null stage as the literal `__unassigned`.
  const rows = await em.getConnection().execute<
    Array<{
      stage_id: string | null
      currency: string | null
      total: string | number | null
      count: string | number
      open_count: string | number
    }>
  >(
    `SELECT
        pipeline_stage_id AS stage_id,
        UPPER(COALESCE(value_currency, '')) AS currency,
        COALESCE(SUM(value_amount), 0) AS total,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE status = 'open') AS open_count
      FROM customer_deals
      WHERE ${whereSql}
      GROUP BY pipeline_stage_id, UPPER(COALESCE(value_currency, ''))`,
    values,
  )

  // Reduce to per-stage aggregates
  const stageMap = new Map<string, StageAggregate>()
  for (const row of rows) {
    const stageId = row.stage_id ?? '__unassigned'
    const total = Number(row.total ?? 0)
    const count = Number(row.count ?? 0)
    const openCount = Number(row.open_count ?? 0)
    const currency = (row.currency ?? '').toString().trim()

    if (!stageMap.has(stageId)) {
      stageMap.set(stageId, {
        stageId,
        count: 0,
        openCount: 0,
        totalInBaseCurrency: 0,
        byCurrency: [],
        convertedAll: true,
        missingRateCurrencies: [],
      })
    }
    const agg = stageMap.get(stageId)!
    agg.count += count
    agg.openCount += openCount
    if (currency.length > 0 && Math.abs(total) > 0) {
      agg.byCurrency.push({ currency, total, count })
    }
  }

  // Convert to base currency where possible
  if (baseCurrencyCode) {
    const exchange = container.resolve('exchangeRateService') as ExchangeRateService | undefined
    const today = new Date()
    const distinctCurrencies = new Set<string>()
    for (const agg of stageMap.values()) {
      for (const row of agg.byCurrency) {
        if (row.currency && row.currency !== baseCurrencyCode) {
          distinctCurrencies.add(row.currency)
        }
      }
    }

    const rateCache = new Map<string, number>()
    if (exchange && distinctCurrencies.size > 0) {
      const pairs = Array.from(distinctCurrencies).map((c) => ({
        fromCurrencyCode: c,
        toCurrencyCode: baseCurrencyCode,
      }))
      try {
        const results = await exchange.getRates({
          pairs,
          date: today,
          scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
          options: { maxDaysBack: 60, autoFetch: false },
        })
        for (const [key, rateResult] of results) {
          if (rateResult.rates.length > 0) {
            // Pick the first matching rate (sources are equivalent for display purposes)
            const rate = Number(rateResult.rates[0].rate)
            if (Number.isFinite(rate) && rate > 0) {
              rateCache.set(key, rate)
            }
          }
        }
      } catch {
        // Swallow — partial totals are still useful and we'll fall back to currency-native sums
      }
    }

    for (const agg of stageMap.values()) {
      let totalBase = 0
      let convertedAll = true
      const missingRateCurrencies: string[] = []
      for (const row of agg.byCurrency) {
        if (!row.currency) continue
        if (row.currency === baseCurrencyCode) {
          totalBase += row.total
          continue
        }
        const key = `${row.currency}/${baseCurrencyCode}`
        const rate = rateCache.get(key)
        if (rate !== undefined) {
          totalBase += row.total * rate
        } else {
          convertedAll = false
          if (!missingRateCurrencies.includes(row.currency)) {
            missingRateCurrencies.push(row.currency)
          }
        }
      }
      // Even when some rates are missing, totalInBaseCurrency reflects the converted slice.
      // `convertedAll`/`missingRateCurrencies` let the client distinguish a complete
      // conversion from a partial one and disclose which currencies were excluded.
      agg.totalInBaseCurrency = Math.round(totalBase)
      agg.convertedAll = convertedAll
      agg.missingRateCurrencies = missingRateCurrencies
    }
  } else {
    // No base currency configured for the tenant — surface this by marking every stage as
    // "not converted" with all currencies flagged as missing rates. This way the client UI
    // can fall back to a per-currency breakdown without trying to render a board total.
    for (const agg of stageMap.values()) {
      const present = agg.byCurrency.map((row) => row.currency).filter((c): c is string => !!c)
      if (present.length > 0) {
        agg.convertedAll = false
        agg.missingRateCurrencies = Array.from(new Set(present))
      }
    }
  }

  // Sort byCurrency rows by total descending for stable display
  for (const agg of stageMap.values()) {
    agg.byCurrency.sort((a, b) => b.total - a.total)
  }

  const response: AggregateResponse = {
    baseCurrencyCode,
    perStage: Array.from(stageMap.values()),
  }

  return NextResponse.json(response)
}
