import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { DashboardLayout } from '@open-mercato/core/modules/dashboards/data/entities'
import { dashboardLayoutSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'
import { resolveAllowedWidgetIds } from '@open-mercato/core/modules/dashboards/lib/access'
import { hasFeature } from '@open-mercato/shared/security/features'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  dashboardsTag,
  dashboardsErrorSchema,
  dashboardsOkSchema,
  dashboardLayoutStateSchema,
} from '../openapi'

const DEFAULT_SIZE = 'md'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view'] },
  PUT: { requireAuth: true, requireFeatures: ['dashboards.configure'] },
}

type LayoutScope = {
  userId: string
  tenantId: string | null
  organizationId: string | null
}

async function loadScopeLayout(em: any, scope: LayoutScope): Promise<DashboardLayout | null> {
  return await em.findOne(DashboardLayout, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

function normalizeLayoutItems(items: any[]) {
  const list = Array.isArray(items) ? items : []
  const seenIds = new Set<string>()
  const sanitized = list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id),
      widgetId: String(item.widgetId),
      order: Number.isInteger(item.order) ? Number(item.order) : undefined,
      priority: Number.isInteger(item.priority) ? Number(item.priority) : undefined,
      size: typeof item.size === 'string' ? item.size : undefined,
      settings: item.settings,
    }))
    .filter((item) => {
      if (!item.id || !item.widgetId) return false
      if (seenIds.has(item.id)) return false
      seenIds.add(item.id)
      return true
    })
    .sort((a, b) => {
      const aOrder = a.order ?? a.priority ?? 0
      const bOrder = b.order ?? b.priority ?? 0
      return aOrder - bOrder
    })
    .map((item, idx) => ({ ...item, order: idx, priority: idx }))
  return sanitized
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  // Use a fresh fork to avoid carrying over pending entities from other operations
  const em = (container.resolve('em') as any).fork({ clear: true, freshEventManager: true, useContext: true })
  const rbac = container.resolve('rbacService') as any
  const url = new URL(req.url)

  const scope: LayoutScope = {
    userId: String(auth.sub),
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }

  const acl = await rbac.loadAcl(scope.userId, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  const widgets = await loadAllWidgets()
  const allowedIds = await resolveAllowedWidgetIds(
    em,
    {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      features: acl.features ?? [],
      isSuperAdmin: !!acl.isSuperAdmin,
    },
    widgets,
  )
  const allowedWidgets = widgets.filter((w) => allowedIds.includes(w.metadata.id))

  let layout = await loadScopeLayout(em, scope)
  let items = layout ? normalizeLayoutItems(layout.layoutJson) : []
  let hasChanged = false

  if (!layout) {
    const defaults = allowedWidgets.filter((widget) => widget.metadata.defaultEnabled)
    items = defaults.map((widget, index) => ({
      id: randomUUID(),
      widgetId: widget.metadata.id,
      order: index,
      priority: index,
      size: widget.metadata.defaultSize ?? DEFAULT_SIZE,
      settings: widget.metadata.defaultSettings ?? undefined,
    }))
    layout = em.create(DashboardLayout, {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      layoutJson: items,
    })
    em.persist(layout)
    hasChanged = true
  } else {
    const existingLayout = layout
    const filtered = items.filter((item) => allowedIds.includes(item.widgetId))
    if (filtered.length !== items.length) {
      hasChanged = true
      items = filtered
    }
    items = items.map((item, index) => (item.order !== index || item.priority !== index ? { ...item, order: index, priority: index } : item))
    if (
      existingLayout.layoutJson.length !== items.length ||
      items.some((item, idx) => existingLayout.layoutJson[idx]?.id !== item.id)
    ) {
      hasChanged = true
    }
    existingLayout.layoutJson = items
    layout = existingLayout
  }

  if (hasChanged) {
    await em.flush()
  }

  const canConfigure = acl.isSuperAdmin || hasFeature(acl.features, 'dashboards.configure')

  let userEmail: string | null = null
  let userName: string | null = null
  let userLabel: string | null = null
  const user = await em.findOne(User, { id: scope.userId, deletedAt: null })
  if (user) {
    userName = user.name?.trim() ?? null
    userEmail = user.email ?? null
    userLabel = (userName && userName.length > 0 ? userName : userEmail) ?? null
  }
  if (!userLabel) {
    userLabel = scope.userId
  }

  const response = {
    layout: { items },
    allowedWidgetIds: allowedIds,
    canConfigure,
    context: {
      ...scope,
      userName,
      userEmail,
      userLabel,
    },
    widgets: allowedWidgets.map((widget) => ({
      id: widget.metadata.id,
      title: widget.metadata.title,
      description: widget.metadata.description ?? null,
      defaultSize: widget.metadata.defaultSize ?? DEFAULT_SIZE,
      defaultEnabled: !!widget.metadata.defaultEnabled,
      defaultSettings: widget.metadata.defaultSettings ?? null,
      features: widget.metadata.features ?? [],
      moduleId: widget.moduleId,
      icon: widget.metadata.icon ?? null,
      loaderKey: widget.key,
      supportsRefresh: !!widget.metadata.supportsRefresh,
    })),
  }

  return NextResponse.json(response)
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = dashboardLayoutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid layout payload', issues: parsed.error.issues }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = (resolve('em') as any).fork({ clear: true, freshEventManager: true, useContext: true })
  const rbac = resolve('rbacService') as any

  const scope: LayoutScope = {
    userId: String(auth.sub),
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }

  const acl = await rbac.loadAcl(scope.userId, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  if (!acl.isSuperAdmin && !hasFeature(acl.features, 'dashboards.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const widgets = await loadAllWidgets()
  const allowedIds = await resolveAllowedWidgetIds(
    em,
    {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      features: acl.features ?? [],
      isSuperAdmin: !!acl.isSuperAdmin,
    },
    widgets,
  )
  const allowedSet = new Set(allowedIds)

  const payloadItems = parsed.data.items
  const sanitized = payloadItems
    .map((item, index) => ({
      id: item.id,
      widgetId: item.widgetId,
      order: index,
      priority: index,
      size: item.size ?? DEFAULT_SIZE,
      settings: item.settings,
    }))
    .filter((item) => allowedSet.has(item.widgetId))

  const uniqueIds = new Set(sanitized.map((item) => item.id))
  if (uniqueIds.size !== sanitized.length) {
    return NextResponse.json({ error: 'Layout item IDs must be unique' }, { status: 400 })
  }

  let layout = await loadScopeLayout(em, scope)
  if (!layout) {
    layout = em.create(DashboardLayout, {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      layoutJson: sanitized,
    })
    em.persist(layout)
  } else {
    layout.layoutJson = sanitized
  }
  await em.flush()

  return NextResponse.json({ ok: true })
}

const layoutGetDoc: OpenApiMethodDoc = {
  summary: 'Load the current dashboard layout',
  description: 'Returns the saved widget layout together with the widgets the current user is allowed to place.',
  tags: [dashboardsTag],
  responses: [
    {
      status: 200,
      description: 'Current dashboard layout and available widgets.',
      schema: dashboardLayoutStateSchema,
    },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
  ],
}

const layoutPutDoc: OpenApiMethodDoc = {
  summary: 'Persist dashboard layout changes',
  description: 'Saves the provided widget ordering, sizes, and settings for the current user.',
  tags: [dashboardsTag],
  requestBody: {
    contentType: 'application/json',
    schema: dashboardLayoutSchema,
    description: 'List of dashboard widgets with ordering, sizing, and settings.',
  },
  responses: [
    { status: 200, description: 'Layout updated successfully.', schema: dashboardsOkSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid layout payload', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing dashboards.configure feature', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Manage personal dashboard layout',
  methods: {
    GET: layoutGetDoc,
    PUT: layoutPutDoc,
  },
}
