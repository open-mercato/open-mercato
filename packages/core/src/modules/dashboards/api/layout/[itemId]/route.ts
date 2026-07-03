import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { DashboardLayout } from '@open-mercato/core/modules/dashboards/data/entities'
import { dashboardLayoutItemPatchSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { normalizeLayoutState, serializeLayoutStateForStoredShape } from '@open-mercato/core/modules/dashboards/lib/layoutState'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  dashboardsTag,
  dashboardsErrorSchema,
  dashboardsOkSchema,
  dashboardLayoutItemUpdateSchema,
} from '../../openapi'

const DEFAULT_SIZE = 'md'
const RESOURCE_KIND = 'dashboards.layout'

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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const parsed = dashboardLayoutItemPatchSchema.safeParse({ ...(body as Record<string, unknown>), id: layoutItemId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as EntityManager
  const rbac = resolve('rbacService') as RbacService

  const scope = {
    userId: String(auth.sub),
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }

  const acl = await rbac.loadAcl(scope.userId, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, 'dashboards.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: scope.tenantId ?? '',
    organizationId: scope.organizationId,
    userId: scope.userId,
    resourceKind: RESOURCE_KIND,
    resourceId: layoutItemId,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { id: layoutItemId, size: parsed.data.size, settings: parsed.data.settings },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
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

  const layoutState = normalizeLayoutState(layout.layoutJson)
  const idx = layoutState.items.findIndex((item) => item.id === layoutItemId)
  if (idx === -1) {
    return NextResponse.json({ error: 'Layout item not found' }, { status: 404 })
  }

  const current = layoutState.items[idx]
  if (!current) {
    return NextResponse.json({ error: 'Layout item not found' }, { status: 404 })
  }
  const items = [...layoutState.items]
  items[idx] = {
    ...current,
    size: parsed.data.size ?? current.size ?? DEFAULT_SIZE,
    settings: parsed.data.settings ?? current.settings,
  }
  layout.layoutJson = serializeLayoutStateForStoredShape(layout.layoutJson, {
    items,
    ...(layoutState.preferences ? { preferences: layoutState.preferences } : {}),
  })
  await em.flush()

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: scope.tenantId ?? '',
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: RESOURCE_KIND,
      resourceId: layoutItemId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

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
