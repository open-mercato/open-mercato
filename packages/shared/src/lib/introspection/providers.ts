import type { IntrospectionContext, SurfaceProvider, SurfaceRow } from './types'

type RowFactory = (ctx: IntrospectionContext) => SurfaceRow[] | Promise<SurfaceRow[]>

function provider(
  id: string,
  title: string,
  tier: 1 | 2 | 3,
  columns: string[],
  collectRows: RowFactory,
): SurfaceProvider {
  return {
    id,
    title,
    tier,
    describe: () => ({ columns }),
    collect: collectRows,
  }
}

async function modulesFrom(ctx: IntrospectionContext) {
  if (ctx.modules.length) return ctx.modules
  const { getModules } = await import('../modules/registry')
  return getModules()
}

function asString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value.filter((entry): entry is string => typeof entry === 'string')
  return items.length ? items : null
}

const moduleProvider = provider('module', 'Modules', 1, ['id', 'title', 'version', 'requires'], async (ctx) =>
  (await modulesFrom(ctx)).map((mod) => ({
    id: mod.id,
    title: mod.info?.title ?? mod.info?.name ?? null,
    version: mod.info?.version ?? null,
    requires: mod.info?.requires ?? null,
  })),
)

const eventProvider = provider('event', 'Events', 1, ['id', 'label', 'category', 'entity', 'clientBroadcast', 'portalBroadcast'], async () => {
  const { getDeclaredEvents } = await import('../../modules/events/factory')
  return getDeclaredEvents().map((event) => ({
    id: event.id,
    label: event.label,
    category: event.category ?? null,
    entity: event.entity ?? null,
    clientBroadcast: event.clientBroadcast === true,
    portalBroadcast: event.portalBroadcast === true,
  }))
})

const subscriberProvider = provider(
  'subscriber',
  'Subscribers',
  1,
  ['id', 'moduleId', 'event', 'persistent', 'sync', 'priority'],
  async (ctx) =>
    (await modulesFrom(ctx)).flatMap((mod) =>
      (mod.subscribers ?? []).map((sub) => ({
        id: sub.id,
        moduleId: mod.id,
        event: sub.event,
        persistent: sub.persistent === true,
        sync: sub.sync === true,
        priority: sub.priority ?? null,
      })),
    ),
)

const aclFeatureProvider = provider('acl-feature', 'ACL Features', 1, ['id', 'title', 'moduleId'], async (ctx) =>
  (await modulesFrom(ctx)).flatMap((mod) =>
    (mod.features ?? []).map((feature) => ({
      id: feature.id,
      title: feature.title,
      moduleId: feature.module ?? mod.id,
    })),
  ),
)

async function safeCoreInjectionWidgets() {
  try {
    const { getCoreInjectionWidgets } = await import('../../modules/widgets/injection-loader')
    return getCoreInjectionWidgets()
  } catch {
    return []
  }
}

async function safeCoreInjectionTables() {
  try {
    const { getCoreInjectionTables } = await import('../../modules/widgets/injection-loader')
    return getCoreInjectionTables()
  } catch {
    return []
  }
}

const widgetSpotProvider = provider('widget-spot', 'Widget Spots', 1, ['spotId', 'moduleId', 'widgetCount'], async () => {
  const rows: SurfaceRow[] = []
  for (const entry of await safeCoreInjectionTables()) {
    for (const [spotId, slot] of Object.entries(entry.table)) {
      const slots = Array.isArray(slot) ? slot : [slot]
      rows.push({
        spotId,
        moduleId: entry.moduleId,
        widgetCount: slots.length,
      })
    }
  }
  return rows.sort((a, b) => String(a.spotId).localeCompare(String(b.spotId)))
})

const widgetProvider = provider('widget', 'Injection Widgets', 1, ['key', 'moduleId', 'widgetId', 'source'], async () =>
  (await safeCoreInjectionWidgets()).map((entry) => ({
    key: entry.key,
    moduleId: entry.moduleId,
    widgetId: entry.widgetId ?? null,
    source: entry.source,
  })),
)

const apiRouteProvider = provider('api-route', 'API Routes', 1, ['moduleId', 'path', 'methods', 'kind'], async () => {
  const { getApiRouteManifests } = await import('../../modules/registry')
  return getApiRouteManifests().map((route) => ({
    moduleId: route.moduleId,
    path: route.path,
    methods: route.methods,
    kind: route.kind,
  }))
})

const searchEntityProvider = provider(
  'search-entity',
  'Search Entities',
  1,
  ['moduleId', 'entityType', 'label', 'strategies'],
  async () => {
    const { getSearchModuleConfigs } = await import('../../modules/search')
    return getSearchModuleConfigs().flatMap((config) =>
      (config.entities ?? []).map((entity) => ({
        moduleId: config.moduleId,
        entityType: entity.entityType,
        label: entity.label ?? null,
        strategies: entity.strategies ?? null,
      })),
    )
  },
)

const navItemProvider = provider('nav-item', 'Navigation Items', 1, ['moduleId', 'path', 'title', 'context', 'group'], async () => {
  const { getBackendRouteManifests, getFrontendRouteManifests } = await import('../../modules/registry')
  const rows: SurfaceRow[] = []
  for (const route of getBackendRouteManifests()) {
    if (route.navHidden) continue
    const path = route.pattern ?? route.path ?? '/'
    rows.push({
      moduleId: route.moduleId,
      path,
      title: route.title ?? route.titleKey ?? null,
      context: route.pageContext ?? 'main',
      group: route.group ?? route.groupKey ?? null,
    })
  }
  for (const route of getFrontendRouteManifests()) {
    if (route.navHidden) continue
    const path = route.pattern ?? route.path ?? '/'
    rows.push({
      moduleId: route.moduleId,
      path,
      title: route.title ?? route.titleKey ?? null,
      context: 'frontend',
      group: route.group ?? route.groupKey ?? null,
    })
  }
  return rows.sort((a, b) => String(a.path).localeCompare(String(b.path)))
})

const customEntityProvider = provider('custom-entity', 'Custom Entities (static)', 1, ['id', 'moduleId', 'label', 'description'], async (ctx) =>
  (await modulesFrom(ctx)).flatMap((mod) =>
    (mod.customEntities ?? []).map((entity) => ({
      id: entity.id,
      moduleId: mod.id,
      label: entity.label ?? null,
      description: entity.description ?? null,
    })),
  ),
)

const notificationProvider = provider('notification', 'Notifications', 1, ['id', 'moduleId', 'label'], (ctx) => {
  const types = ctx.snapshot?.notificationTypes ?? []
  return types.map((entry) => {
    const typed = entry as Record<string, unknown>
    return {
      id: asString(typed.id) ?? asString(typed.type) ?? 'unknown',
      moduleId: asString(typed.moduleId) ?? asString(typed.module) ?? null,
      label: asString(typed.label) ?? asString(typed.title) ?? null,
    }
  })
})

const notificationHandlerProvider = provider(
  'notification-handler',
  'Notification Handlers',
  1,
  ['id', 'moduleId', 'notificationType', 'features'],
  async () => {
    const { getNotificationHandlerEntries } = await import('../notifications/handler-registry')
    return getNotificationHandlerEntries().flatMap((entry) =>
      (entry.handlers ?? []).map((handler) => ({
        id: handler.id,
        moduleId: entry.moduleId,
        notificationType: handler.notificationType,
        features: handler.features ?? null,
      })),
    )
  },
)

const enricherProvider = provider('enricher', 'Response Enrichers', 1, ['id', 'moduleId', 'targetEntity', 'priority', 'features'], async () => {
  const { getResponseEnrichers } = await import('../crud/enricher-registry')
  return getResponseEnrichers().map((entry) => ({
    id: entry.enricher.id,
    moduleId: entry.moduleId,
    targetEntity: entry.enricher.targetEntity,
    priority: entry.enricher.priority ?? null,
    features: entry.enricher.features ?? null,
  }))
})

const interceptorProvider = provider('interceptor', 'API Interceptors', 1, ['id', 'moduleId', 'targetRoute', 'methods', 'priority'], async () => {
  const { getAllApiInterceptors } = await import('../crud/interceptor-registry')
  return getAllApiInterceptors().map((entry) => ({
    id: entry.interceptor.id,
    moduleId: entry.moduleId,
    targetRoute: entry.interceptor.targetRoute,
    methods: entry.interceptor.methods ?? null,
    priority: entry.interceptor.priority ?? null,
  }))
})

const commandInterceptorProvider = provider(
  'command-interceptor',
  'Command Interceptors',
  1,
  ['id', 'moduleId', 'commandId', 'phase', 'priority'],
  async () => {
    const { getAllCommandInterceptors } = await import('../commands/command-interceptor-store')
    return getAllCommandInterceptors().map((entry) => ({
      id: entry.interceptor.id,
      moduleId: entry.moduleId,
      commandId: entry.interceptor.commandId,
      phase: entry.interceptor.phase,
      priority: entry.interceptor.priority ?? null,
    }))
  },
)

const workflowProvider = provider('workflow', 'Workflows', 1, ['workflowId', 'moduleId', 'workflowName', 'enabled'], async () => {
  try {
    const { getAllCodeWorkflows } = await import('@open-mercato/core/modules/workflows/lib/code-registry')
    return getAllCodeWorkflows().map((workflow) => ({
      workflowId: workflow.workflowId,
      moduleId: workflow.moduleId ?? null,
      workflowName: workflow.workflowName ?? null,
      enabled: workflow.enabled === true,
    }))
  } catch {
    return []
  }
})

const aiToolProvider = provider('ai-tool', 'AI Tools', 1, ['name', 'moduleId', 'description', 'requiredFeatures'], (ctx) => {
  const entries = ctx.snapshot?.aiToolConfigEntries ?? []
  return entries.flatMap((entry) =>
    (entry.tools ?? []).map((tool) => {
      const typed = tool as Record<string, unknown>
      return {
        name: asString(typed.name) ?? 'unknown',
        moduleId: entry.moduleId,
        description: asString(typed.description) ?? null,
        requiredFeatures: asStringArray(typed.requiredFeatures) ?? asStringArray(typed.features),
      }
    }),
  )
})

const componentOverrideProvider = provider(
  'component-override',
  'Component Overrides',
  1,
  ['targetComponentId', 'moduleId', 'priority', 'mode', 'features'],
  async () => {
    const { getAllComponentOverrides } = await import('../../modules/widgets/component-registry')
    return getAllComponentOverrides().map((override) => ({
      targetComponentId: override.target.componentId,
      moduleId: override.metadata?.module ?? null,
      priority: override.priority,
      mode: 'replacement' in override ? 'replacement' : 'wrapper' in override ? 'wrapper' : 'propsTransform',
      features: override.features ?? null,
    }))
  },
)

const guardProvider = provider('guard', 'Mutation Guards', 1, ['id', 'moduleId', 'entityId', 'operation'], async () => {
  const { getAllMutationGuards } = await import('../crud/mutation-guard-store')
  return getAllMutationGuards().map((entry) => ({
    id: entry.guard.id,
    moduleId: entry.moduleId,
    entityId: entry.guard.entityId ?? null,
    operation: entry.guard.operation ?? null,
  }))
})

const analyticsProvider = provider('analytics', 'Analytics', 1, ['moduleId', 'entityId', 'label'], async () => {
  const { getAnalyticsModuleConfigs } = await import('../../modules/analytics')
  return getAnalyticsModuleConfigs().flatMap((config) =>
    (config.entities ?? []).map((entity) => ({
      moduleId: config.moduleId,
      entityId: entity.entityId,
      label: entity.label ?? null,
    })),
  )
})

const messageTypeProvider = provider('message-type', 'Message Types', 1, ['type', 'moduleId', 'label'], async () => {
  try {
    const { getAllMessageTypes } = await import('@open-mercato/core/modules/messages/lib/message-types-registry')
    return getAllMessageTypes().map((entry) => ({
      type: entry.type,
      moduleId: entry.module,
      label: entry.label ?? null,
    }))
  } catch {
    return []
  }
})

const dashboardWidgetProvider = provider('dashboard-widget', 'Dashboard Widgets', 1, ['key', 'moduleId', 'source'], async () => {
  try {
    const { getDashboardWidgets } = await import('@open-mercato/ui/backend/dashboard/widgetRegistry')
    return getDashboardWidgets().map((entry) => ({
      key: entry.key,
      moduleId: entry.moduleId,
      source: entry.source,
    }))
  } catch {
    return []
  }
})

const diKeyProvider = provider('di-key', 'DI Keys', 2, ['key', 'lifetime'], (ctx) => {
  const container = ctx.container
  if (!container) return []
  return Object.keys(container.registrations)
    .sort()
    .map((key) => ({
      key,
      lifetime: asString((container.registrations[key] as { lifetime?: unknown }).lifetime) ?? null,
    }))
})

const aclRoleGrantProvider = provider(
  'acl-role-grant',
  'ACL Role Grants',
  3,
  ['roleId', 'roleName', 'tenantId', 'isSuperAdmin', 'features'],
  async (ctx) => {
    if (!ctx.em || !ctx.tenantId) return []
    const { RoleAcl } = await import('@open-mercato/core/modules/auth/data/entities')
    const tenantId = ctx.tenantId
    const grants = await ctx.em.find(
      RoleAcl,
      { tenantId, deletedAt: null },
      { populate: ['role'] as const },
    )
    return grants.map((grant) => ({
      roleId: String(grant.role.id),
      roleName: grant.role.name ?? null,
      tenantId: grant.tenantId,
      isSuperAdmin: grant.isSuperAdmin === true,
      features: grant.featuresJson ?? null,
    }))
  },
)

const customFieldProvider = provider(
  'custom-field',
  'Custom Fields (tenant)',
  3,
  ['entityId', 'key', 'kind', 'tenantId', 'organizationId', 'isActive'],
  async (ctx) => {
    if (!ctx.em || !ctx.tenantId) return []
    const { CustomFieldDef } = await import('@open-mercato/core/modules/entities/data/entities')
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      deletedAt: null,
    }
    if (ctx.organizationId) {
      where.organizationId = ctx.organizationId
    }
    const defs = await ctx.em.find(CustomFieldDef, where)
    return defs.map((def) => ({
      entityId: def.entityId,
      key: def.key,
      kind: def.kind,
      tenantId: def.tenantId ?? null,
      organizationId: def.organizationId ?? null,
      isActive: def.isActive === true,
    }))
  },
)

const eventFlowProvider = provider(
  'event-flow',
  'Event Flow (derived)',
  1,
  ['eventId', 'subscriberCount', 'status'],
  async (ctx) => {
    const { getDeclaredEvents } = await import('../../modules/events/factory')
    const events = new Set(getDeclaredEvents().map((event) => event.id))
    const subscribers = (await modulesFrom(ctx)).flatMap((mod) => mod.subscribers ?? [])
    const byEvent = new Map<string, number>()
    const orphanSubscribers: string[] = []

    for (const sub of subscribers) {
      if (!events.has(sub.event)) {
        orphanSubscribers.push(sub.id)
        continue
      }
      byEvent.set(sub.event, (byEvent.get(sub.event) ?? 0) + 1)
    }

    const rows: SurfaceRow[] = []
    for (const eventId of [...events].sort()) {
      const count = byEvent.get(eventId) ?? 0
      rows.push({
        eventId,
        subscriberCount: count,
        status: count === 0 ? 'dead-event' : 'ok',
      })
    }

    for (const subscriberId of orphanSubscribers.sort()) {
      const sub = subscribers.find((entry) => entry.id === subscriberId)
      rows.push({
        eventId: sub?.event ?? subscriberId,
        subscriberCount: 0,
        status: 'orphan-subscriber',
      })
    }

    return rows
  },
)

const aclMatrixProvider = provider(
  'acl-matrix',
  'ACL Matrix (derived)',
  1,
  ['featureId', 'roles', 'liveGrantCount'],
  async (ctx) => {
    const staticFeatures = (await modulesFrom(ctx)).flatMap((mod) => mod.features ?? [])
    const featureIds = [...new Set(staticFeatures.map((feature) => feature.id))].sort()

    const liveByFeature = new Map<string, Set<string>>()
    if (ctx.em && ctx.tenantId) {
      const { RoleAcl } = await import('@open-mercato/core/modules/auth/data/entities')
      const grants = await ctx.em.find(RoleAcl, { tenantId: ctx.tenantId, deletedAt: null }, { populate: ['role'] as const })
      for (const grant of grants) {
        const roleName = grant.role.name ?? grant.role.id
        for (const feature of grant.featuresJson ?? []) {
          if (!liveByFeature.has(feature)) liveByFeature.set(feature, new Set())
          liveByFeature.get(feature)?.add(roleName)
        }
        if (grant.isSuperAdmin) {
          for (const featureId of featureIds) {
            if (!liveByFeature.has(featureId)) liveByFeature.set(featureId, new Set())
            liveByFeature.get(featureId)?.add(roleName)
          }
        }
      }
    }

    return featureIds.map((featureId) => {
      const roles = liveByFeature.get(featureId)
      return {
        featureId,
        roles: roles ? [...roles].sort() : null,
        liveGrantCount: roles?.size ?? 0,
      }
    })
  },
)

export const builtInSurfaceProviders: SurfaceProvider[] = [
  moduleProvider,
  eventProvider,
  subscriberProvider,
  aclFeatureProvider,
  widgetSpotProvider,
  widgetProvider,
  apiRouteProvider,
  searchEntityProvider,
  navItemProvider,
  customEntityProvider,
  notificationProvider,
  notificationHandlerProvider,
  enricherProvider,
  interceptorProvider,
  commandInterceptorProvider,
  workflowProvider,
  aiToolProvider,
  componentOverrideProvider,
  guardProvider,
  analyticsProvider,
  messageTypeProvider,
  dashboardWidgetProvider,
  diKeyProvider,
  aclRoleGrantProvider,
  customFieldProvider,
  eventFlowProvider,
  aclMatrixProvider,
]
