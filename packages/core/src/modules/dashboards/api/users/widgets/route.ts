import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { DashboardUserWidgets } from '@open-mercato/core/modules/dashboards/data/entities'
import { userWidgetSettingsSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'
import { resolveAllowedWidgetIds } from '@open-mercato/core/modules/dashboards/lib/access'
import { hasFeature } from '@open-mercato/shared/security/features'

const FEATURE = 'dashboards.admin.assign-widgets'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [FEATURE] },
  PUT: { requireAuth: true, requireFeatures: [FEATURE] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const userId = url.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  const tenantId = url.searchParams.get('tenantId') || auth.tenantId || null
  const organizationId = url.searchParams.get('organizationId') || auth.orgId || null

  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const rbac = container.resolve('rbacService') as any
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, FEATURE)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const widgets = await loadAllWidgets()
  const targetAcl = await rbac.loadAcl(userId, { tenantId, organizationId })
  const allowed = await resolveAllowedWidgetIds(
    em,
    {
      userId,
      tenantId,
      organizationId,
      features: targetAcl.features ?? [],
      isSuperAdmin: !!targetAcl.isSuperAdmin,
    },
    widgets,
  )

  const record = await em.findOne(DashboardUserWidgets, {
    userId,
    tenantId,
    organizationId,
    deletedAt: null,
  })

  const response = {
    mode: record ? record.mode : 'inherit',
    widgetIds: record && record.mode === 'override' ? record.widgetIdsJson : [],
    hasCustom: !!record && record.mode === 'override',
    effectiveWidgetIds: allowed,
    scope: { tenantId, organizationId },
  }

  return NextResponse.json(response)
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = userWidgetSettingsSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbac = resolve('rbacService') as any
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, FEATURE)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const widgets = await loadAllWidgets()
  const validWidgetIds = new Set(widgets.map((w) => w.metadata.id))
  const widgetIds = parsed.data.widgetIds.filter((id) => validWidgetIds.has(id))

  const tenantId = parsed.data.tenantId ?? auth.tenantId ?? null
  const organizationId = parsed.data.organizationId ?? auth.orgId ?? null

  let record = await em.findOne(DashboardUserWidgets, {
    userId: parsed.data.userId,
    tenantId,
    organizationId,
    deletedAt: null,
  })

  if (parsed.data.mode === 'inherit') {
    if (record) {
      await em.remove(record)
      await em.flush()
    }
    return NextResponse.json({ ok: true, mode: 'inherit', widgetIds: [] })
  }

  if (!record) {
    record = em.create(DashboardUserWidgets, {
      userId: parsed.data.userId,
      tenantId,
      organizationId,
      mode: 'override',
      widgetIdsJson: widgetIds,
    })
    em.persist(record)
  } else {
    record.mode = 'override'
    record.widgetIdsJson = widgetIds
  }
  await em.flush()

  return NextResponse.json({ ok: true, mode: 'override', widgetIds })
}
