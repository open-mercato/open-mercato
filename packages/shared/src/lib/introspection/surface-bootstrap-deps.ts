import { SURFACE_CATALOG } from './surface-catalog'
import type { SurfaceTier } from './types'

export type IntrospectionBootstrapFile =
  | 'modulesApp'
  | 'events'
  | 'notifications'
  | 'messageTypes'
  | 'messageObjectTypes'
  | 'aiTools'
  | 'workflows'
  | 'dashboardWidgets'
  | 'injectionWidgets'
  | 'injectionTables'
  | 'enrichers'
  | 'interceptors'
  | 'componentOverrides'
  | 'guards'
  | 'commandInterceptors'
  | 'notificationHandlers'
  | 'analytics'
  | 'bootstrapRegistrations'

const SURFACE_BOOTSTRAP_FILES: Record<string, IntrospectionBootstrapFile[]> = {
  module: ['modulesApp'],
  event: ['events'],
  subscriber: ['modulesApp'],
  'acl-feature': ['modulesApp'],
  'widget-spot': ['injectionWidgets', 'injectionTables'],
  widget: ['injectionWidgets'],
  'api-route': ['bootstrapRegistrations'],
  'search-entity': [],
  'nav-item': ['bootstrapRegistrations'],
  'custom-entity': ['modulesApp'],
  notification: ['notifications'],
  'notification-handler': ['notificationHandlers'],
  enricher: ['enrichers'],
  interceptor: ['interceptors'],
  'command-interceptor': ['commandInterceptors'],
  workflow: ['workflows'],
  'ai-tool': ['aiTools'],
  'component-override': ['componentOverrides'],
  guard: ['guards'],
  analytics: ['analytics'],
  'message-type': ['messageTypes'],
  'dashboard-widget': ['dashboardWidgets'],
  'di-key': [],
  'acl-role-grant': [],
  'custom-field': [],
  'event-flow': ['events', 'modulesApp'],
  'acl-matrix': ['modulesApp'],
}

const ALL_TIER12_SURFACE_IDS = SURFACE_CATALOG.filter((entry) => entry.tier <= 2).map((entry) => entry.id)

export function resolveBootstrapFilesForSurfaces(input: {
  surfaceIds?: string[]
  maxTier?: SurfaceTier
}): Set<IntrospectionBootstrapFile> {
  const maxTier = input.maxTier ?? 2
  const surfaceIds = input.surfaceIds?.length
    ? input.surfaceIds
    : ALL_TIER12_SURFACE_IDS.filter((surfaceId) => {
        const entry = SURFACE_CATALOG.find((candidate) => candidate.id === surfaceId)
        return entry ? entry.tier <= maxTier : true
      })

  const files = new Set<IntrospectionBootstrapFile>()
  for (const surfaceId of surfaceIds) {
    const deps = SURFACE_BOOTSTRAP_FILES[surfaceId]
    if (!deps) continue
    for (const file of deps) {
      files.add(file)
    }
  }

  if (maxTier >= 3) {
    files.add('modulesApp')
  }

  return files
}
