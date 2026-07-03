import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { DashboardLayout } from '@open-mercato/core/modules/dashboards/data/entities'
import { dashboardLayoutSchema } from '@open-mercato/core/modules/dashboards/data/validators'
import { loadAllWidgets } from '@open-mercato/core/modules/dashboards/lib/widgets'
import { resolveAllowedWidgetIds } from '@open-mercato/core/modules/dashboards/lib/access'
import { normalizeLayoutState, serializeLayoutStateForStoredShape } from '@open-mercato/core/modules/dashboards/lib/layoutState'
import { hasFeature } from '@open-mercato/shared/security/features'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { DashboardLayoutItem } from '@open-mercato/shared/modules/dashboard/widgets'
import {
  dashboardsTag,
  dashboardsErrorSchema,
  dashboardLayoutUpdateResponseSchema,
  dashboardLayoutStateSchema,
} from '../openapi'

const DEFAULT_SIZE = 'md'
const RESOURCE_KIND = 'dashboards.layout'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.view'] },
  PUT: { requireAuth: true, requireFeatures: ['dashboards.configure'] },
}

type LayoutScope = {
  userId: string
  tenantId: string | null
  organizationId: string | null
}

async function loadScopeLayout(em: EntityManager, scope: LayoutScope): Promise<DashboardLayout | null> {
  return await em.findOne(DashboardLayout, {
    userId: scope.userId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

function haveLayoutItemsChanged(previous: DashboardLayoutItem[], next: DashboardLayoutItem[]): boolean {
  if (previous.length !== next.length) return true
  return next.some((item, index) => {
    const previousItem = previous[index]
    if (!previousItem) return true
    return (
      previousItem.id !== item.id ||
      previousItem.widgetId !== item.widgetId ||
      previousItem.order !== item.order ||
      previousItem.priority !== item.priority ||
      previousItem.size !== item.size ||
      previousItem.settings !== item.settings
    )
  })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  // Use a fresh fork to avoid carrying over pending entities from other operations
  const em = (container.resolve('em') as EntityManager).fork({ clear: true, freshEventManager: true, useContext: true })
  const rbac = container.resolve('rbacService') as RbacService
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
  const layoutState = layout ? normalizeLayoutState(layout.layoutJson) : { items: [] }
  const allowedIdSet = new Set(allowedIds)
  let items = layoutState.items
  // Drop widgets the caller may no longer see from saved presets too (reindexed), so a
  // preset can never resurrect a forbidden widget when switched to.
  const presets = layoutState.presets?.map((preset) => ({
    ...preset,
    items: preset.items
      .filter((item) => allowedIdSet.has(item.widgetId))
      .map((item, index) => ({ ...item, order: index, priority: index })),
  }))
  const activePresetId = presets?.some((preset) => preset.id === layoutState.activePresetId) ? layoutState.activePresetId : undefined
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
      createdAt: new Date(),
    })
    em.persist(layout)
    hasChanged = true
  } else {
    const existingLayout = layout
    const originalItems = layoutState.items
    const filtered = items.filter((item) => allowedIds.includes(item.widgetId))
    if (filtered.length !== items.length) {
      hasChanged = true
      items = filtered
    }
    items = items.map((item, index) => (item.order !== index || item.priority !== index ? { ...item, order: index, priority: index } : item))
    if (haveLayoutItemsChanged(originalItems, items)) {
      hasChanged = true
    }
    existingLayout.layoutJson = serializeLayoutStateForStoredShape(existingLayout.layoutJson, {
      items,
      ...(layoutState.preferences ? { preferences: layoutState.preferences } : {}),
      ...(presets ? { presets } : {}),
      ...(activePresetId ? { activePresetId } : {}),
    })
    layout = existingLayout
  }

  if (hasChanged) {
    await em.flush()
  }

  const canConfigure = acl.isSuperAdmin || hasFeature(acl.features, 'dashboards.configure')

  let userEmail: string | null = null
  let userName: string | null = null
  let userLabel: string | null = null
  const user = await findOneWithDecryption(
    em,
    User,
    { id: scope.userId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId ?? null, organizationId: scope.organizationId ?? null },
  )
  if (user) {
    userName = user.name?.trim() ?? null
    userEmail = user.email ?? null
    userLabel = (userName && userName.length > 0 ? userName : userEmail) ?? null
  }
  if (!userLabel) {
    userLabel = scope.userId
  }

  const response = {
    layout: {
      items,
      ...(layoutState.preferences ? { preferences: layoutState.preferences } : {}),
      ...(presets ? { presets } : {}),
      ...(activePresetId ? { activePresetId } : {}),
    },
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

  const container = await createRequestContainer()
  const { resolve } = container
  const em = (resolve('em') as EntityManager).fork({ clear: true, freshEventManager: true, useContext: true })
  const rbac = resolve('rbacService') as RbacService

  const scope: LayoutScope = {
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
    resourceId: scope.userId,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { items: parsed.data.items, preferences: parsed.data.preferences },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
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

  const sanitizePresetItems = (rawItems: typeof payloadItems) =>
    rawItems
      .map((item, index) => ({ id: item.id, widgetId: item.widgetId, order: index, priority: index, size: item.size ?? DEFAULT_SIZE, settings: item.settings }))
      .filter((item) => allowedSet.has(item.widgetId))

  const sanitizedPresets = parsed.data.presets?.map((preset) => ({
    id: preset.id,
    name: preset.name,
    items: sanitizePresetItems(preset.items),
    ...(preset.preferences ? { preferences: preset.preferences } : {}),
  }))
  for (const preset of sanitizedPresets ?? []) {
    if (new Set(preset.items.map((item) => item.id)).size !== preset.items.length) {
      return NextResponse.json({ error: 'Preset item IDs must be unique' }, { status: 400 })
    }
  }
  const activePresetId = sanitizedPresets?.some((preset) => preset.id === parsed.data.activePresetId) ? parsed.data.activePresetId : undefined

  const storedLayout = {
    items: sanitized,
    ...(parsed.data.preferences ? { preferences: parsed.data.preferences } : {}),
    ...(sanitizedPresets && sanitizedPresets.length > 0 ? { presets: sanitizedPresets } : {}),
    ...(activePresetId ? { activePresetId } : {}),
  }

  let layout = await loadScopeLayout(em, scope)
  if (!layout) {
    layout = em.create(DashboardLayout, {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      layoutJson: storedLayout,
      createdAt: new Date(),
    })
    em.persist(layout)
  } else {
    layout.layoutJson = storedLayout
  }
  await em.flush()

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: scope.tenantId ?? '',
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: RESOURCE_KIND,
      resourceId: scope.userId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json({
    ok: true,
    ...(parsed.data.preferences ? { preferences: parsed.data.preferences } : {}),
    ...(sanitizedPresets && sanitizedPresets.length > 0 ? { presets: sanitizedPresets } : {}),
    ...(activePresetId ? { activePresetId } : {}),
  })
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
    { status: 200, description: 'Layout updated successfully.', schema: dashboardLayoutUpdateResponseSchema },
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
