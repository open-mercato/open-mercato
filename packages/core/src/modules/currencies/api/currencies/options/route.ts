import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant } from '@open-mercato/cache'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  buildCollectionTags,
  debugCrudCache,
  isCrudCacheEnabled,
  resolveCrudCache,
} from '@open-mercato/shared/lib/crud/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Currency } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['currencies.view'] },
}

const CURRENCY_OPTIONS_RESOURCE = 'currencies.currency'
const CURRENCY_OPTIONS_TTL_MS = 5 * 60_000

function buildOptionsCacheKey(params: {
  orgId: string | null
  includeInactive: boolean
  limit: number
}): string {
  return `currencies:options:org=${params.orgId ?? 'null'}:active=${params.includeInactive ? 'all' : 'active'}:limit=${params.limit}`
}

const optionsQuerySchema = z.object({
  q: z.string().optional(),
  query: z.string().optional(),
  search: z.string().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
}).loose()

type OptionsItem = {
  value: string
  label: string
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) {
    return NextResponse.json({ items: [] }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = optionsQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    query: url.searchParams.get('query') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    includeInactive: url.searchParams.get('includeInactive') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [] }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { q, query, search, includeInactive, limit } = parsed.data
  const searchTerm = (q ?? query ?? search ?? '').trim()
  const tenantId = auth.tenantId
  const orgId = auth.orgId ?? null
  const includeInactiveFlag = includeInactive === 'true'

  // Only the unfiltered bootstrap call (no ILIKE search term) is the hot path
  // worth caching; search variants would multiply key cardinality with little
  // hit-rate benefit, so they always read straight through.
  const cache =
    isCrudCacheEnabled() && !searchTerm ? resolveCrudCache(container) : null
  const cacheKey = cache
    ? buildOptionsCacheKey({ orgId, includeInactive: includeInactiveFlag, limit })
    : null

  if (cache && cacheKey) {
    try {
      const cached = await runWithCacheTenant(tenantId, () => cache.get(cacheKey))
      if (cached) {
        return NextResponse.json(cached)
      }
    } catch (err) {
      // A cache-backend read error must degrade to a fresh DB read, never a 500.
      debugCrudCache('get', {
        resource: CURRENCY_OPTIONS_RESOURCE,
        key: cacheKey,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const filter: any = {
    tenantId,
    deletedAt: null,
  }
  if (orgId) {
    filter.organizationId = orgId
  }

  if (!includeInactiveFlag) {
    filter.isActive = true
  }

  if (searchTerm) {
    const escaped = escapeLikePattern(searchTerm)
    filter.$or = [
      { code: { $ilike: `%${escaped}%` } },
      { name: { $ilike: `%${escaped}%` } },
    ]
  }

  const rows = await em.find(Currency, filter, {
    orderBy: { code: 'ASC' },
    limit,
  })

  const items: OptionsItem[] = rows.map((currency) => ({
    value: String(currency.code),
    label: `${currency.code} - ${currency.name}`,
  }))

  const payload = { items }

  if (cache && cacheKey) {
    try {
      await runWithCacheTenant(tenantId, () =>
        cache.set(cacheKey, payload, {
          ttl: CURRENCY_OPTIONS_TTL_MS,
          tags: buildCollectionTags(CURRENCY_OPTIONS_RESOURCE, tenantId, [orgId]),
        }),
      )
    } catch (err) {
      // A cache write must never break the request; log it for observability
      // instead of swallowing the failure silently (matches the CRUD factory).
      debugCrudCache('store', {
        resource: CURRENCY_OPTIONS_RESOURCE,
        key: cacheKey,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json(payload)
}

const optionsResponseSchema = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
    })
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Currencies',
  summary: 'Currency options',
  methods: {
    GET: {
      summary: 'List currency options',
      description: 'Returns currencies formatted for select inputs.',
      query: optionsQuerySchema,
      responses: [
        { status: 200, description: 'Option list', schema: optionsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: z.object({ items: z.array(z.any()) }) },
        { status: 400, description: 'Invalid query', schema: z.object({ items: z.array(z.any()) }) },
      ],
    },
  },
}
