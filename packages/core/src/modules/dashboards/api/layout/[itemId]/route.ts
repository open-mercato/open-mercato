import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { DashboardLayout } from '@open-mercato/core/modules/dashboards/data/entities'
import { dashboardLayoutItemPatchSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { hasFeature } from '@open-mercato/shared/security/features'

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
