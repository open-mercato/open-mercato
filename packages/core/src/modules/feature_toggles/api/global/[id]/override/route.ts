import { getAuthFromRequest } from "@/lib/auth/server"
import { createRequestContainer } from "@/lib/di/container"
import { EntityManager } from "@mikro-orm/postgresql"
import { NextResponse } from "next/server"
import { resolveFeatureCheckContext } from "@open-mercato/core/modules/directory/utils/organizationScope"
import { Tenant } from "@open-mercato/core/modules/directory/data/entities"
import { logCrudAccess } from "@open-mercato/shared/lib/crud/factory"
import { OpenApiRouteDoc } from "@/lib/openapi"
import { FeatureToggleOverride } from '../../../../data/entities'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { scope } = await resolveFeatureCheckContext({ container: await createRequestContainer(), auth, request: req })

  const id = params.id
  if (!id) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager


  const tenant = await em.findOne(Tenant, { id: scope.tenantId })
  if (!tenant) {
    return NextResponse.json({
      error: 'Tenant context required. Please select a tenant.'
    }, { status: 400 })
  }


  const override = await em.findOne(FeatureToggleOverride, {
    tenantId: tenant.id,
    toggle: { id: id },
  })

  const responseOverride = {
    id: override?.id ?? '',
    state: override?.state ?? 'inherit',
    tenantName: tenant.name,
    tenantId: tenant.id,
  }

  await logCrudAccess({
    container,
    auth,
    request: req,
    items: [responseOverride],
    idField: 'id',
    resourceKind: 'feature_toggles.feature_toggle_override',
    tenantId: auth.tenantId ?? null,
    query: {},
    accessType: 'read:item',
    fields: ['id', 'tenantId', 'state', 'toggle']
  })

  return NextResponse.json(responseOverride)
}

const routeMetadata = {
  GET: { requireAuth: true, requireRoles: ['superadmin'] },
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