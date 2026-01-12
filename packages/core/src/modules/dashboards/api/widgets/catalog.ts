import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dashboardsTag, dashboardsErrorSchema, dashboardWidgetCatalogSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.admin.assign-widgets'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const rbac = resolve('rbacService') as any
  const acl = await rbac.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, 'dashboards.admin.assign-widgets')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const widgets = await loadAllWidgets()
  return NextResponse.json({
    items: widgets.map((widget) => ({
      id: widget.metadata.id,
      title: widget.metadata.title,
      description: widget.metadata.description ?? null,
      defaultSize: widget.metadata.defaultSize ?? 'md',
      defaultEnabled: !!widget.metadata.defaultEnabled,
      defaultSettings: widget.metadata.defaultSettings ?? null,
      features: widget.metadata.features ?? [],
      moduleId: widget.moduleId,
      icon: widget.metadata.icon ?? null,
      loaderKey: widget.key,
      supportsRefresh: !!widget.metadata.supportsRefresh,
    })),
  })
}

const widgetCatalogGetDoc: OpenApiMethodDoc = {
  summary: 'List available dashboard widgets',
  description: 'Returns the catalog of widgets that modules expose, including defaults and feature requirements.',
  tags: [dashboardsTag],
  responses: [
    { status: 200, description: 'Widgets available for assignment.', schema: dashboardWidgetCatalogSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Insufficient permissions to view widget catalog', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Dashboard widget catalog',
  methods: {
    GET: widgetCatalogGetDoc,
  },
}
