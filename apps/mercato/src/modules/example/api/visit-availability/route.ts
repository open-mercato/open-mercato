import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveCustomersRequestContext, resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { evaluateVisitAvailability, visitAvailabilityInputSchema } from '../../lib/visitAvailability'

const querySchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  staffUserIds: z.string().optional(),
  resourceIds: z.string().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
}

export async function GET(request: Request) {
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const input = visitAvailabilityInputSchema.parse({
      startAt: query.startAt,
      endAt: query.endAt,
      staffUserIds: query.staffUserIds ? query.staffUserIds.split(',') : [],
      resourceIds: query.resourceIds ? query.resourceIds.split(',') : [],
    })
    const context = await resolveCustomersRequestContext(request)
    if (!context.selectedOrganizationId) return NextResponse.json({ error: 'example.calendar.visitAvailability.missingScope' }, { status: 403 })
    const actorUserId = resolveAuthActorId(context.auth)
    const rbac = context.container.hasRegistration('rbacService')
      ? context.container.resolve<{ userHasAllFeatures: (userId: string, features: string[], scope: { tenantId: string; organizationId: string }) => Promise<boolean> }>('rbacService')
      : null
    if (!rbac || !await rbac.userHasAllFeatures(actorUserId, ['customers.interactions.manage'], { tenantId: context.auth.tenantId, organizationId: context.selectedOrganizationId })) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const subjects = await evaluateVisitAvailability({
      container: context.container,
      actorUserId,
      scope: { tenantId: context.auth.tenantId, organizationId: context.selectedOrganizationId },
      input,
    })
    return NextResponse.json({ subjects })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid availability query' }, { status: 400 })
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    return NextResponse.json({ error: 'example.calendar.visitAvailability.retry' }, { status: 503 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Example',
  summary: 'Preview Visit availability',
  methods: {
    GET: {
      summary: 'Check availability of selected staff and resources',
      description: 'Returns scoped per-subject availability for a proposed Visit interval.',
      query: querySchema,
      responses: [{ status: 200, description: 'Availability preview', schema: z.object({ subjects: z.array(z.object({
        type: z.enum(['staff', 'resource']), id: z.string().uuid(), status: z.enum(['available', 'unavailable', 'unknown']), reasonKey: z.string().nullable(),
      })) }) }],
      errors: [
        { status: 400, description: 'Invalid interval or subject IDs', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Insufficient access', schema: z.object({ error: z.string() }) },
        { status: 503, description: 'Availability source failed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
