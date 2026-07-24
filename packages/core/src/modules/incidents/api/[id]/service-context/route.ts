import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Incident } from '../../../data/entities'
import { resolveIncidentServiceContext } from '../../../lib/serviceContext'
import {
  incidentImpactPathParamsSchema,
  impactErrorResponseSchema,
  resolveIncidentImpactRequestContext,
} from '../impacts/route'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.incident.view'] },
}

const serviceContextComponentSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  componentType: z.string(),
  ownerTeamId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  criticality: z.string(),
  tier: z.string().nullable(),
  sloTargetBasisPoints: z.number().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean(),
  impacted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const serviceContextDependencySchema = z.object({
  id: z.string().uuid(),
  sourceComponentId: z.string().uuid(),
  targetComponentId: z.string().uuid(),
  dependencyKind: z.string(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const serviceContextResponseSchema = z.object({
  incidentId: z.string().uuid(),
  impactedComponentIds: z.array(z.string().uuid()),
  freeformComponentLabels: z.array(z.string()),
  components: z.array(serviceContextComponentSchema),
  dependencies: z.array(serviceContextDependencySchema),
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = incidentImpactPathParamsSchema.parse(params)
    const { ctx } = await resolveIncidentImpactRequestContext(req)
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId) throw new CrudHttpError(401, { error: '[internal] tenant scope required' })
    if (!organizationId) throw new CrudHttpError(400, { error: '[internal] organization scope required' })
    const scope = { organizationId, tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!incident) throw new CrudHttpError(404, { error: '[internal] incident not found' })

    const serviceContext = await resolveIncidentServiceContext(em, scope, id)
    return NextResponse.json(serviceContextResponseSchema.parse(serviceContext))
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.service-context GET failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.service_context_failed', 'Failed to load incident service context.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Incident service context',
  pathParams: incidentImpactPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get service dependency context',
      description: 'Returns impacted incident service components, freeform component labels, and first-hop service dependency edges for an incident.',
      responses: [
        { status: 200, description: 'Incident service context', schema: serviceContextResponseSchema },
        { status: 401, description: 'Unauthorized', schema: impactErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: impactErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: impactErrorResponseSchema },
      ],
    },
  },
}
