import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { FeatureToggle } from '../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'

import { featureTogglesTag, featureToggleSchema, featureToggleErrorSchema } from '../../openapi'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid feature toggle id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const toggle = await em.findOne(FeatureToggle, {
    id: parse.data.id,
  })

  if (!toggle) {
    return NextResponse.json({ error: 'Feature toggle not found' }, { status: 404 })
  }

  await logCrudAccess({
    container,
    auth,
    request: _req,
    items: [toggle],
    idField: 'id',
    resourceKind: 'feature_toggles.feature_toggle',
    tenantId: auth.tenantId ?? null,
    query: { id: parse.data.id },
    accessType: 'read:item',
    fields: ['id', 'identifier', 'name', 'description', 'category', 'created_at', 'updated_at']
  })

  const featureToggle: FeatureToggle = {
    id: toggle.id,
    identifier: toggle.identifier,
    name: toggle.name,
    description: toggle.description ?? null,
    category: toggle.category ?? null,

    type: toggle.type,
    defaultValue: toggle.defaultValue,
    createdAt: toggle.createdAt,
    updatedAt: toggle.updatedAt,
  }

  return NextResponse.json(featureToggle)
}

const routeMetadata = {
  GET: { requireAuth: true, requireRoles: ['superadmin'] },
}

export const metadata = routeMetadata

export const openApi: OpenApiRouteDoc = {
  tag: featureTogglesTag,
  summary: 'Fetch feature toggle detail',
  methods: {
    GET: {
      summary: 'Fetch feature toggle by ID',
      description: 'Returns complete details of a feature toggle.',
      responses: [
        { status: 200, description: 'Feature toggle detail', schema: featureToggleSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: featureToggleErrorSchema },
        { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
        { status: 404, description: 'Feature toggle not found', schema: featureToggleErrorSchema },
      ],
    },
  },
}
