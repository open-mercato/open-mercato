import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { DashboardRoleWidgets } from '@open-mercato/core/modules/dashboards/data/entities'
import { roleWidgetSettingsSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'
import { hasFeature } from '@open-mercato/shared/security/features'

const FEATURE = 'dashboards.admin.assign-widgets'

function pickBestRecord(records: DashboardRoleWidgets[], tenantId: string | null, organizationId: string | null): DashboardRoleWidgets | null {
  let best: DashboardRoleWidgets | null = null
  let bestScore = -1
  for (const record of records) {
    if (record.deletedAt) continue
    if (record.tenantId && tenantId && record.tenantId !== tenantId) continue
    if (record.tenantId && !tenantId) continue
    if (record.organizationId && organizationId && record.organizationId !== organizationId) continue
    if (record.organizationId && !organizationId) continue
    const score = (record.tenantId ? 1 : 0) + (record.organizationId ? 2 : 0)
    if (score > bestScore) {
      best = record
      bestScore = score
    }
  }
  return best
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [FEATURE] },
  PUT: { requireAuth: true, requireFeatures: [FEATURE] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const roleId = url.searchParams.get('roleId')
  if (!roleId) return NextResponse.json({ error: 'roleId is required' }, { status: 400 })
  const tenantId = url.searchParams.get('tenantId') || auth.tenantId || null
  const organizationId = url.searchParams.get('organizationId') || null

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbac = resolve('rbacService') as any
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, FEATURE)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const records = await em.find(DashboardRoleWidgets, { roleId, deletedAt: null })
  const best = pickBestRecord(records, tenantId, organizationId)

  return NextResponse.json({
    widgetIds: best ? best.widgetIdsJson : [],
    hasCustom: !!best,
    scope: {
      tenantId,
      organizationId,
    },
  })
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
  const parsed = roleWidgetSettingsSchema.safeParse(payload)
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
  const organizationId = parsed.data.organizationId ?? null

  let record = await em.findOne(DashboardRoleWidgets, {
    roleId: parsed.data.roleId,
    tenantId,
    organizationId,
    deletedAt: null,
  })

  if (!widgetIds.length) {
    if (record) {
      await em.removeAndFlush(record)
    }
    return NextResponse.json({ ok: true, widgetIds: [] })
  }

  if (!record) {
    record = em.create(DashboardRoleWidgets, {
      roleId: parsed.data.roleId,
      tenantId,
      organizationId,
      widgetIdsJson: widgetIds,
    })
    em.persist(record)
  } else {
    record.widgetIdsJson = widgetIds
  }
  await em.flush()

  return NextResponse.json({ ok: true, widgetIds })
}
