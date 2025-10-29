import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { DashboardLayout } from '@open-mercato/core/modules/dashboards/data/entities'
import { dashboardLayoutItemPatchSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  dashboardsTag,
  dashboardsErrorSchema,
  dashboardsOkSchema,
  dashboardLayoutItemUpdateSchema,
} from '../../openapi'

const DEFAULT_SIZE = 'md'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['dashboards.configure'] },
}

export async function PATCH(req: Request, ctx: { params?: { itemId?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const layoutItemId = ctx.params?.itemId
  if (!layoutItemId) return NextResponse.json({ error: 'Missing layout item id' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = dashboardLayoutItemPatchSchema.safeParse({ ...body, id: layoutItemId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbac = resolve('rbacService') as any

  const scope = {
    userId: String(auth.sub),
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }

  const acl = await rbac.loadAcl(scope.userId, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, 'dashboards.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const layout = await em.findOne(DashboardLayout, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!layout) {
    return NextResponse.json({ error: 'Layout not found' }, { status: 404 })
  }

  const idx = layout.layoutJson.findIndex((item) => item.id === layoutItemId)
  if (idx === -1) {
    return NextResponse.json({ error: 'Layout item not found' }, { status: 404 })
  }

  const current = layout.layoutJson[idx]
  layout.layoutJson[idx] = {
    ...current,
    size: parsed.data.size ?? current.size ?? DEFAULT_SIZE,
    settings: parsed.data.settings ?? current.settings,
  }
  await em.flush()

  return NextResponse.json({ ok: true })
}

const layoutItemParamsSchema = z.object({
  itemId: z.string().uuid(),
})

const layoutItemPatchDoc: OpenApiMethodDoc = {
  summary: 'Update a dashboard layout item',
  description: 'Adjusts the size or settings for a single widget within the dashboard layout.',
  tags: [dashboardsTag],
  requestBody: {
    contentType: 'application/json',
    schema: dashboardLayoutItemUpdateSchema,
    description: 'Payload containing the new size or settings for the widget.',
  },
  responses: [
    { status: 200, description: 'Layout item updated.', schema: dashboardsOkSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid payload or missing item id', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing dashboards.configure feature', schema: dashboardsErrorSchema },
    { status: 404, description: 'Item not found', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Update dashboard layout item',
  pathParams: layoutItemParamsSchema,
  methods: {
    PATCH: layoutItemPatchDoc,
  },
}
