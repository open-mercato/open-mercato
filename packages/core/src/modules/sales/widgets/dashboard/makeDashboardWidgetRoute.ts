import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityName, FilterQuery, FindOptions } from '@mikro-orm/core'
import type { CacheStrategy } from '@open-mercato/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runWithCacheTenant } from '@open-mercato/cache'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveDateRange } from '@open-mercato/ui/backend/date-range'
import type { DatePeriodOption } from '../../api/dashboard/widgets/helpers'
import { resolveWidgetScope, type WidgetScopeContext } from '@open-mercato/core/modules/dashboards/lib/widgetScope'

const WIDGET_CACHE_TTL = 120_000
const WIDGET_CACHE_SEGMENT_TTL = 86_400_000
const WIDGET_CACHE_SEGMENT_KEY = 'widget-data:__segment__'

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
  datePeriod: z.enum(['last24h', 'last7d', 'last30d', 'custom']).default('last24h'),
  customFrom: z.string().optional(),
  customTo: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

type WidgetContext = WidgetScopeContext & {
  limit: number
  datePeriod: DatePeriodOption
  customFrom?: string
  customTo?: string
}

function normalizeOrganizationIds(organizationIds: string[] | null): string[] | null {
  if (organizationIds === null) return null
  const set = new Set(organizationIds)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

function buildCacheKey(
  cacheId: string,
  params: {
    tenantId: string
    organizationIds: string[] | null
    limit: number
    datePeriod: DatePeriodOption
    customFrom?: string
    customTo?: string
  }
): string {
  const hash = createHash('sha256')
  hash.update(
    JSON.stringify({
      widget: cacheId,
      ...params,
      organizationIds: normalizeOrganizationIds(params.organizationIds),
    })
  )
  return `widget-data:${hash.digest('hex').slice(0, 16)}`
}

async function resolveContext(req: Request, translate: (key: string, fallback?: string) => string): Promise<WidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) rawQuery[key] = value
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: translate('sales.errors.invalid_query', 'Invalid query parameters') })
  }

  const { container, em, tenantId, organizationIds } = await resolveWidgetScope(req, translate, {
    tenantId: parsed.data.tenantId ?? null,
    organizationId: parsed.data.organizationId ?? null,
  })

  return {
    container,
    em,
    tenantId,
    organizationIds,
    limit: parsed.data.limit,
    datePeriod: parsed.data.datePeriod,
    customFrom: parsed.data.customFrom,
    customTo: parsed.data.customTo,
  }
}

export interface DashboardWidgetRouteConfig<TEntity extends object, TItem extends Record<string, unknown>> {
  entity: { new (...args: unknown[]): TEntity }
  cacheId: string
  cacheTags: string[]
  feature: string
  mapItem: (entity: Record<string, unknown>) => TItem
  itemSchema: z.ZodTypeAny
  openApi: {
    summary: string
    description: string
    getSummary: string
    itemDescription: string
    errorFallback: string
  }
  errorPrefix: string
}

type WidgetResponse<TItem> = {
  items: TItem[]
  total: number
  dateRange: {
    from: string
    to: string
  }
}

const widgetErrorSchema = z.object({ error: z.string() })

export function makeDashboardWidgetRoute<TEntity extends object, TItem extends Record<string, unknown>>(config: DashboardWidgetRouteConfig<TEntity, TItem>) {
  const cacheTags = ['widget-data', ...config.cacheTags]

  const metadata = {
    GET: { requireAuth: true, requireFeatures: ['dashboards.view', config.feature] },
  }

  async function GET(req: Request) {
    const { translate } = await resolveTranslations()
    try {
      const { container, em, tenantId, organizationIds, limit, datePeriod, customFrom, customTo } = await resolveContext(
        req,
        translate
      )
      const range = (() => {
        if (datePeriod === 'custom') {
          const from = customFrom ? new Date(customFrom) : new Date(0)
          const to = customTo ? new Date(customTo) : new Date()
          return { start: from, end: to }
        }
        const preset = datePeriod === 'last7d' ? 'last_7_days' : datePeriod === 'last30d' ? 'last_30_days' : 'today'
        return resolveDateRange(preset)
      })()

      let cache: CacheStrategy | null = null
      try {
        cache = container.resolve<CacheStrategy>('cache')
      } catch {
        cache = null
      }

      const cacheKey = buildCacheKey(config.cacheId, { tenantId, organizationIds, limit, datePeriod, customFrom, customTo })
      const tenantScope = tenantId ?? null

      if (cache) {
        try {
          const cached = await runWithCacheTenant(tenantScope, () => cache!.get(cacheKey))
          if (cached && typeof cached === 'object' && 'items' in (cached as object)) {
            return NextResponse.json(cached)
          }
        } catch (err) {
          console.debug('[widget-cache] read failed', err)
        }
      }

      const where: FilterQuery<{ tenantId: string; deletedAt: Date | null; createdAt: Date; organizationId: string }> = {
        tenantId,
        deletedAt: null,
        createdAt: { $gte: range.start, $lte: range.end },
      }

      if (Array.isArray(organizationIds)) {
        const unique = Array.from(new Set(organizationIds))
        where.organizationId = unique.length === 1 ? unique[0] : { $in: unique }
      }

      const organizationIdScope = Array.isArray(organizationIds) && organizationIds.length === 1 ? organizationIds[0] : null
      // Generic boundary: config.entity is a class constructor from the factory caller,
      // so we cast to EntityName/FilterQuery at the call site (matching findAndCountWithDecryption's own internal casts)
      const [entities, total] = await findAndCountWithDecryption(
        em,
        config.entity as EntityName<TEntity>,
        where as FilterQuery<TEntity>,
        { limit, orderBy: { createdAt: 'desc' as const } } as FindOptions<TEntity>,
        { tenantId, organizationId: organizationIdScope },
      )

      const items = (entities as unknown as Record<string, unknown>[]).map(config.mapItem)

      const response: WidgetResponse<TItem> = {
        items,
        total,
        dateRange: { from: range.start.toISOString(), to: range.end.toISOString() },
      }

      if (cache) {
        try {
          await runWithCacheTenant(tenantScope, () => cache!.set(cacheKey, response, { ttl: WIDGET_CACHE_TTL, tags: cacheTags }))
          await runWithCacheTenant(tenantScope, () => cache!.set(
            WIDGET_CACHE_SEGMENT_KEY,
            { updatedAt: response.dateRange.to },
            { ttl: WIDGET_CACHE_SEGMENT_TTL, tags: ['widget-data'] },
          ))
        } catch (err) {
          console.debug('[widget-cache] write failed', err)
        }
      }

      return NextResponse.json(response)
    } catch (err) {
      if (err instanceof CrudHttpError) {
        return NextResponse.json(err.body, { status: err.status })
      }
      console.error(`${config.errorPrefix} failed`, err)
      return NextResponse.json(
        { error: translate(`${config.errorPrefix}.error`, config.openApi.errorFallback) },
        { status: 500 },
      )
    }
  }

  const responseSchema = z.object({
    items: z.array(config.itemSchema),
    total: z.number(),
    dateRange: z.object({
      from: z.string(),
      to: z.string(),
    }),
  })

  const openApi: OpenApiRouteDoc = {
    tag: 'Sales',
    summary: config.openApi.summary,
    description: config.openApi.description,
    methods: {
      GET: {
        summary: config.openApi.getSummary,
        query: querySchema,
        responses: [{ status: 200, description: config.openApi.itemDescription, schema: responseSchema }],
        errors: [
          { status: 400, description: 'Invalid query parameters', schema: widgetErrorSchema },
          { status: 401, description: 'Unauthorized', schema: widgetErrorSchema },
          { status: 403, description: 'Forbidden', schema: widgetErrorSchema },
          { status: 500, description: 'Widget failed to load', schema: widgetErrorSchema },
        ],
      },
    },
  }

  return { GET, metadata, openApi }
}
