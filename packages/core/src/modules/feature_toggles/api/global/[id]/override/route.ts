import { getAuthFromRequest } from "@open-mercato/shared/lib/auth/server"
import { createRequestContainer } from "@open-mercato/shared/lib/di/container"
import { EntityManager } from "@mikro-orm/postgresql"
import { NextResponse } from "next/server"
import { resolveFeatureCheckContext } from "@open-mercato/core/modules/directory/utils/organizationScope"
import { Tenant } from "@open-mercato/core/modules/directory/data/entities"
import { logCrudAccess } from "@open-mercato/shared/lib/crud/factory"
import { OpenApiRouteDoc } from "@open-mercato/shared/lib/openapi"
import { FeatureToggleOverride, FeatureToggle } from '../../../../data/entities'
import { FeatureToggleOverrideResponse } from '../../../../data/validators'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const container = await createRequestContainer()
  const { scope } = await resolveFeatureCheckContext({ container, auth, request: req })
  const parsed = paramsSchema.safeParse({ id: params.id })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const em = container.resolve('em') as EntityManager


  const tenant = await em.findOne(Tenant, { id: scope.tenantId })
  if (!tenant) {
    return NextResponse.json({
      error: 'Tenant context required. Please select a tenant.'
    }, { status: 400 })
  }


  const toggle = await em.findOne(FeatureToggle, { id: parsed.data.id, deletedAt: null })
  if (!toggle) {
    return NextResponse.json({ error: 'Feature toggle not found' }, { status: 404 })
  }

  const override = await em.findOne(FeatureToggleOverride, {
    tenantId: tenant.id,
    toggle: { id: parsed.data.id },
  })

  const responseOverride: FeatureToggleOverrideResponse = {
    id: override?.id ?? '',
    value: override ? override.value : toggle.defaultValue,
    tenantName: tenant.name,
    tenantId: tenant.id,
    toggleType: toggle.type,
    updatedAt: override?.updatedAt instanceof Date ? override.updatedAt.toISOString() : null,
  }

  await logCrudAccess({
    container,
    auth,
    request: req,
    items: [responseOverride],
    idField: 'id',
    resourceKind: 'feature_toggles.feature_toggle_override',
    tenantId: tenant.id,
    query: {},
    accessType: 'read:item',
    fields: ['id', 'tenantId', 'value', 'toggle', 'toggleType']
  })

  return NextResponse.json(responseOverride)
}

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['feature_toggles.view'] },
}

export const metadata = routeMetadata

import { featureTogglesTag, featureToggleErrorSchema, featureToggleOverrideResponseSchema } from '../../../openapi'

export const openApi: OpenApiRouteDoc = {
  tag: featureTogglesTag,
  summary: 'Fetch feature toggle overrides',
  methods: {
    GET: {
      summary: 'Fetch feature toggle override',
      description: 'Returns feature toggle override.',
      responses: [
        {
          status: 200, description: 'Feature toggle overrides', schema: featureToggleOverrideResponseSchema
        },
        { status: 400, description: 'Invalid request', schema: featureToggleErrorSchema },
        { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
        { status: 404, description: 'Feature toggle not found', schema: featureToggleErrorSchema },
      ],
    },
  },
}
