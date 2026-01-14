import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope, getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { BookingEvent } from '../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
}

const querySchema = z.object({
  search: z.string().optional(),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const query = Object.fromEntries(url.searchParams.entries())
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const rbac = resolve('rbacService') as RbacService
  const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
  const organizationIds = scope.filterIds
  if (Array.isArray(organizationIds) && organizationIds.length === 0) {
    return NextResponse.json({ items: [] })
  }
  const organizationFilter =
    Array.isArray(organizationIds) && organizationIds.length > 0
      ? { $in: organizationIds }
      : scope.selectedId
  if (!organizationFilter) {
    return NextResponse.json({ items: [] })
  }

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: organizationFilter,
    deletedAt: null,
  }
  const search = parsed.data.search?.trim()
  if (search) {
    where.title = { $ilike: `%${escapeLikePattern(search)}%` }
  }

  const events = await findWithDecryption(
    em,
    BookingEvent,
    where,
    { orderBy: { startsAt: 'desc' }, limit: parsed.data.pageSize },
    { tenantId: auth.tenantId, organizationId: scope.selectedId ?? null },
  )

  const items = events.map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    status: event.status,
  }))

  return NextResponse.json({ items })
}

const eventOptionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Booking',
  summary: 'List event options',
  methods: {
    GET: {
      summary: 'List event options',
      description: 'Returns a lightweight list of events for selectors.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Event options',
          schema: z.object({ items: z.array(eventOptionSchema) }),
        },
        { status: 400, description: 'Invalid query parameters', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
