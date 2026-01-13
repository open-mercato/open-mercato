import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope, getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { BookingEvent, BookingEventResource } from '../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
}

const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid ISO date string',
})

const querySchema = z
  .object({
    resourceId: z.string().uuid(),
    startsAt: isoDateString,
    endsAt: isoDateString,
  })
  .refine((data) => new Date(data.startsAt) < new Date(data.endsAt), {
    message: 'startsAt must be before endsAt',
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

  const start = new Date(parsed.data.startsAt)
  const end = new Date(parsed.data.endsAt)

  const assignments = await findWithDecryption(
    em,
    BookingEventResource,
    {
      resourceId: parsed.data.resourceId,
      tenantId: auth.tenantId,
      organizationId: organizationFilter,
      deletedAt: null,
    },
    { fields: ['eventId'] },
    { tenantId: auth.tenantId, organizationId: scope.selectedId ?? null },
  )
  const eventIds = assignments.map((assignment) => assignment.eventId)
  if (eventIds.length === 0) {
    return NextResponse.json({ items: [] })
  }

  const events = await findWithDecryption(
    em,
    BookingEvent,
    {
      id: { $in: eventIds },
      tenantId: auth.tenantId,
      organizationId: organizationFilter,
      deletedAt: null,
      status: { $ne: 'cancelled' },
      startsAt: { $lt: end },
      endsAt: { $gt: start },
    },
    { orderBy: { startsAt: 'asc' } },
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

const resourceEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Booking',
  summary: 'List resource events',
  methods: {
    GET: {
      summary: 'List resource events',
      description: 'Returns events assigned to a resource within the provided time window.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Resource events',
          schema: z.object({ items: z.array(resourceEventSchema) }),
        },
        { status: 400, description: 'Invalid query parameters', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
