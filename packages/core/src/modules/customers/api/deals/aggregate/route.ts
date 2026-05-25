import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'
import type { EntityManager as PgEntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { ExchangeRateService } from '@open-mercato/core/modules/currencies/services/exchangeRateService'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { fetchStuckDealIds } from '../../../lib/stuckDeals'
import { findMatchingEntityIdsBySearchTokensAcrossSources } from '../../utils'
import { E } from '#generated/entities.ids.generated'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

const querySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  search: z.string().optional(),
  status: z.array(z.enum(['open', 'closed', 'win', 'loose'])).optional(),
  ownerUserId: z.array(z.string().uuid()).optional(),
  personId: z.array(z.string().uuid()).optional(),
  companyId: z.array(z.string().uuid()).optional(),
  isStuck: z.preprocess((value) => {
    const parsed = parseBooleanFromUnknown(value)
    return parsed === null ? value : parsed
  }, z.boolean()).optional(),
  isOverdue: z.preprocess((value) => {
    const parsed = parseBooleanFromUnknown(value)
    return parsed === null ? value : parsed
  }, z.boolean()).optional(),
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

const stageBreakdownByCurrencySchema = z.object({
  currency: z.string(),
  total: z.number(),
  count: z.number(),
})

const stageAggregateSchema = z.object({
  stageId: z.string(),
  count: z.number(),
  openCount: z.number(),
  totalInBaseCurrency: z.number(),
  byCurrency: z.array(stageBreakdownByCurrencySchema),
  convertedAll: z.boolean(),
  missingRateCurrencies: z.array(z.string()),
})

const aggregateResponseSchema = z.object({
  baseCurrencyCode: z.string().nullable(),
  perStage: z.array(stageAggregateSchema),
})

const aggregateErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Deals aggregate per pipeline stage',
  methods: {
    GET: {
      summary: 'Per-stage counts and currency totals for kanban lane headers',
      description:
        'Returns per-stage counts and totals for deals, with values converted to the tenant base currency where rates are available. Used to power kanban lane headers without loading every deal.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Per-stage aggregate payload', schema: aggregateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: aggregateErrorSchema },
        { status: 401, description: 'Unauthorized', schema: aggregateErrorSchema },
      ],
    },
  },
}

function readArrayParam(searchParams: URLSearchParams, key: string): string[] | null {
  const all = searchParams.getAll(key)
  if (!all.length) return null
  const flat = all.flatMap((v) => v.split(','))
  const trimmed = flat.map((s) => s.trim()).filter(Boolean)
  return trimmed.length ? trimmed : null
}

function restrictToIds(where: string[], values: Array<string | number | null>, ids: string[]) {
  if (ids.length === 0) {
    where.push('id = ?')
    values.push('00000000-0000-0000-0000-000000000000')
    return
  }
  const placeholders = ids.map(() => '?').join(',')
  where.push(`id IN (${placeholders})`)
  values.push(...ids)
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
    search: params.get('search') ?? undefined,
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

  // Resolve organization scope from the request so multi-org operators can aggregate
  // deals for any org their RBAC scope permits (matching the deal detail route at
  // [id]/route.ts:360). Falls back to `auth.orgId` when no scope cookie is set or
  // when rbacService cannot be resolved (e.g. in unit tests with a minimal container).
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const effectiveTenantId = scope.tenantId ?? auth.tenantId
  const orgFilterIds = Array.isArray(scope.filterIds) && scope.filterIds.length > 0
    ? scope.filterIds.filter((id) => typeof id === 'string' && id.length > 0)
    : auth.orgId
      ? [auth.orgId]
      : []
  if (!effectiveTenantId || orgFilterIds.length === 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Raw SQL is used here intentionally — the route only projects non-encrypted columns
  // (`pipeline_stage_id`, `value_amount`, `value_currency`, `status`, plus filters). It
  // avoids the per-row decryption cost that would be paid by `findWithDecryption` for an
  // aggregate that never reads `title`/`description`. The search path still relies on
  // the token index above to find matching deals when encrypted columns are involved.
  const baseCurrency = await em.getConnection().execute<Array<{ code: string }>>(
    `SELECT code FROM currencies WHERE tenant_id = ? AND organization_id = ? AND is_base = true AND deleted_at IS NULL LIMIT 1`,
    [effectiveTenantId, orgFilterIds[0]],
  )
  const baseCurrencyCode = baseCurrency[0]?.code ?? null

  // Build WHERE clause shared between count + sum queries
  const orgPlaceholders = orgFilterIds.map(() => '?').join(',')
  const where: string[] = [
    'tenant_id = ?',
    `organization_id IN (${orgPlaceholders})`,
    'deleted_at IS NULL',
  ]
  const values: Array<string | number | null> = [effectiveTenantId, ...orgFilterIds]

  if (parsed.data.pipelineId) {
    where.push('pipeline_id = ?')
    values.push(parsed.data.pipelineId)
  }
  const search = parsed.data.search?.trim()
  if (search) {
    const searchCtx: CrudCtx = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: orgFilterIds[0],
      organizationIds: orgFilterIds,
      request: req,
    }
    const matchingIds = await findMatchingEntityIdsBySearchTokensAcrossSources({
      ctx: searchCtx,
      query: search,
      sources: [
        {
          entityType: E.customers.customer_deal,
          fields: [
            'title',
            'description',
            'status',
            'pipeline_stage',
            'source',
            'value_amount',
            'value_currency',
            'cf:competitive_risk',
            'cf:implementation_complexity',
          ],
        },
      ],
    })
    if (matchingIds !== null && matchingIds.length > 0) {
      restrictToIds(where, values, matchingIds)
    } else if (isTenantDataEncryptionEnabled()) {
      // `customers:customer_deal.title` and `.description` are declared in
      // `encryption.ts` as encrypted columns. A raw `ILIKE` over the ciphertext would
      // silently match nothing on encrypted tenants and produce misleading lane totals,
      // so we collapse the result to zero rows instead — consistent with the list
      // endpoint's behavior when the token index has nothing to offer.
      restrictToIds(where, values, [])
    } else {
      const searchPattern = `%${escapeLikePattern(search)}%`
      where.push("(title ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\')")
      values.push(searchPattern, searchPattern)
    }
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
    const stuckIds = await fetchStuckDealIds(em as unknown as PgEntityManager, orgFilterIds[0], effectiveTenantId)
    restrictToIds(where, values, stuckIds)
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
    // Include any row that has a real currency code, even when its summed amount is
    // zero — `byCurrency` should agree with `count` so the per-currency breakdown
    // doesn't silently drop deals whose amount happens to be zero. Rows with no
    // currency code at all still get folded into the stage totals via `count`.
    if (currency.length > 0) {
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
          scope: { tenantId: effectiveTenantId, organizationId: orgFilterIds[0] },
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
      } catch (err) {
        // Swallow — partial totals are still useful and we'll fall back to currency-native
        // sums. Logging at warn level so operators can correlate missing-rate disclosures in
        // the UI (`convertedAll: false` / `missingRateCurrencies`) with the underlying error.
        console.warn('[customers.deals.aggregate] exchange-rate lookup failed; falling back to per-currency totals', err)
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
