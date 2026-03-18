import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Currency } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['currencies.view'] },
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
  const filter: any = {
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  if (auth.orgId) {
    filter.organizationId = auth.orgId
  }

  if (includeInactive !== 'true') {
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

  return NextResponse.json({ items })
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
