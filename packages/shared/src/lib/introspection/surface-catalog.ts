import type { SurfaceTier } from './types'

export type SurfaceCatalogEntry = {
  id: string
  title: string
  tier: SurfaceTier
}

/** Isomorphic catalog for UI/CLI labels — keep in sync with builtInSurfaceProviders (see registry.test.ts). */
export const SURFACE_CATALOG: SurfaceCatalogEntry[] = [
  { id: 'module', title: 'Modules', tier: 1 },
  { id: 'event', title: 'Events', tier: 1 },
  { id: 'subscriber', title: 'Subscribers', tier: 1 },
  { id: 'acl-feature', title: 'ACL Features', tier: 1 },
  { id: 'widget-spot', title: 'Widget Spots', tier: 1 },
  { id: 'widget', title: 'Injection Widgets', tier: 1 },
  { id: 'api-route', title: 'API Routes', tier: 1 },
  { id: 'search-entity', title: 'Search Entities', tier: 1 },
  { id: 'nav-item', title: 'Navigation Items', tier: 1 },
  { id: 'custom-entity', title: 'Custom Entities (static)', tier: 1 },
  { id: 'notification', title: 'Notifications', tier: 1 },
  { id: 'notification-handler', title: 'Notification Handlers', tier: 1 },
  { id: 'enricher', title: 'Response Enrichers', tier: 1 },
  { id: 'interceptor', title: 'API Interceptors', tier: 1 },
  { id: 'command-interceptor', title: 'Command Interceptors', tier: 1 },
  { id: 'workflow', title: 'Workflows', tier: 1 },
  { id: 'ai-tool', title: 'AI Tools', tier: 1 },
  { id: 'component-override', title: 'Component Overrides', tier: 1 },
  { id: 'guard', title: 'Mutation Guards', tier: 1 },
  { id: 'analytics', title: 'Analytics', tier: 1 },
  { id: 'message-type', title: 'Message Types', tier: 1 },
  { id: 'dashboard-widget', title: 'Dashboard Widgets', tier: 1 },
  { id: 'di-key', title: 'DI Keys', tier: 2 },
  { id: 'acl-role-grant', title: 'ACL Role Grants', tier: 3 },
  { id: 'custom-field', title: 'Custom Fields (tenant)', tier: 3 },
  { id: 'event-flow', title: 'Event Flow (derived)', tier: 1 },
  { id: 'acl-matrix', title: 'ACL Matrix (derived)', tier: 1 },
]
