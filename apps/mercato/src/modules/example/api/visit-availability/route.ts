import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { evaluateVisitAvailability, resolveVisitService, visitAvailabilityInputSchema, visitAvailabilityWarnings } from '../../lib/visitAvailability'

const querySchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  staffUserIds: z.string().optional(),
  resourceIds: z.string().optional(),
  excludeInteractionId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
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
      excludeInteractionId: query.excludeInteractionId,
    })
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    if (scope?.selectionRejected || (scope?.tenantId && scope.tenantId !== auth.tenantId)) {
      return NextResponse.json({ error: 'example.calendar.visitAvailability.missingScope' }, { status: 403 })
    }
    const allowedOrganizationIds = scope?.allowedIds !== undefined
      ? scope.allowedIds
      : scope?.selectedId
        ? [scope.selectedId]
        : auth.orgId
          ? [auth.orgId]
          : []
    let organizationId = scope?.selectedId ?? auth.orgId ?? null
    // The parent record owns the organization, not the caller's selection: with
    // "All organizations" (or another organization) selected, resolving subjects in
    // the caller's own organization reports them as inactive and blocks a save the
    // server would accept. The edited event supplies `excludeInteractionId`; a new
    // one supplies the parent `entityId`.
    const ownerLookup = input.excludeInteractionId
      ? { entity: 'customers:customer_interaction' as const, id: input.excludeInteractionId }
      : query.entityId
        ? { entity: 'customers:customer_entity' as const, id: query.entityId }
        : null
    if (ownerLookup) {
      const queryEngine = resolveVisitService<QueryEngine>(container, 'queryEngine')
      if (!queryEngine) return NextResponse.json({ error: 'example.calendar.visitAvailability.retry' }, { status: 503 })
      const result = await queryEngine.query<Record<string, unknown>>(ownerLookup.entity, {
        tenantId: auth.tenantId,
        ...(allowedOrganizationIds === null || auth.isSuperAdmin ? {} : { organizationIds: allowedOrganizationIds }),
        filters: { id: ownerLookup.id, deleted_at: null },
        fields: ['id', 'organization_id'],
        page: { page: 1, pageSize: 1 },
      })
      if (!result.items.length) return NextResponse.json({ error: 'example.calendar.visitAvailability.missingScope' }, { status: 404 })
      const recordOrganizationId = result.items[0]?.organizationId ?? result.items[0]?.organization_id
      if (typeof recordOrganizationId !== 'string' || !isOrganizationAccessAllowed({
        isSuperAdmin: auth.isSuperAdmin === true,
        allowedOrganizationIds,
        targetOrganizationId: recordOrganizationId,
      })) return NextResponse.json({ error: 'example.calendar.visitAvailability.missingScope' }, { status: 403 })
      organizationId = recordOrganizationId
    }
    if (!organizationId) return NextResponse.json({ error: 'example.calendar.visitAvailability.missingScope' }, { status: 403 })
    if (!isOrganizationAccessAllowed({
      isSuperAdmin: auth.isSuperAdmin === true,
      allowedOrganizationIds,
      targetOrganizationId: organizationId,
    })) return NextResponse.json({ error: 'example.calendar.visitAvailability.missingScope' }, { status: 403 })
    const actorUserId = auth.sub ?? auth.userId ?? auth.keyId
    if (!actorUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const rbac = container.hasRegistration('rbacService')
      ? container.resolve<{ userHasAllFeatures: (userId: string, features: string[], scope: { tenantId: string; organizationId: string }) => Promise<boolean> }>('rbacService')
      : null
    if (!rbac || !await rbac.userHasAllFeatures(actorUserId, ['customers.interactions.manage'], { tenantId: auth.tenantId, organizationId })) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const subjects = await evaluateVisitAvailability({
      container,
      actorUserId,
      scope: { tenantId: auth.tenantId, organizationId },
      input,
    })
    return NextResponse.json({ subjects, warnings: visitAvailabilityWarnings() })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'example.calendar.visitAvailability.invalidInterval' }, { status: 400 })
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
      responses: [{ status: 200, description: 'Availability preview', schema: z.object({ warnings: z.array(z.string()), subjects: z.array(z.object({
        type: z.enum(['staff', 'resource']), id: z.string().uuid(), status: z.enum(['available', 'unavailable', 'unknown']), reasonKey: z.string().nullable(),
        displayName: z.string().optional(),
      })) }) }],
      errors: [
        { status: 400, description: 'Invalid interval or subject IDs', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Insufficient access', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Interaction unavailable in the allowed scope', schema: z.object({ error: z.string() }) },
        { status: 503, description: 'Availability source failed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
