import type { ReactNode } from 'react'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi/types'
import type { SyncCrudEventResult } from '../lib/crud/sync-event-types'
import type { DashboardWidgetModule } from './dashboard/widgets'
import type { InjectionAnyWidgetModule, ModuleInjectionTable } from './widgets/injection'
import type { IntegrationBundle, IntegrationDefinition } from './integrations/types'

// Context passed to dynamic metadata guards
export type RouteVisibilityContext = { path?: string; auth?: any }

/**
 * Portal sidebar navigation hint. When declared on a portal page's metadata,
 * the page is auto-listed in the portal sidebar (subject to RBAC) by the
 * `/api/customer_accounts/portal/nav` endpoint.
 *
 * Absence of `nav` means the page is routable but not auto-listed (useful for
 * detail pages, create forms, etc.).
 */
export type PortalNavMetadata = {
  label: string
  labelKey?: string
  group?: 'main' | 'account'
  order?: number
  icon?: string
}

// Metadata you can export from page.meta.ts or directly from a server page
export type PageMetadata = {
  requireAuth?: boolean
  /** @deprecated Use `requireFeatures` instead — role names are mutable and can be spoofed */
  requireRoles?: readonly string[]
  // Optional fine-grained feature requirements
  requireFeatures?: readonly string[]
  // Portal: require customer (portal user) authentication instead of staff auth
  requireCustomerAuth?: boolean
  // Portal: require customer-specific features (checked against CustomerRbacService)
  requireCustomerFeatures?: readonly string[]
  // Portal: optional sidebar presentation hint (auto-listed by portal nav endpoint)
  nav?: PortalNavMetadata
  // Titles and grouping (aliases supported)
  title?: string
  titleKey?: string
  pageTitle?: string
  pageTitleKey?: string
  group?: string
  groupKey?: string
  pageGroup?: string
  pageGroupKey?: string
  // Ordering and visuals
  order?: number
  pageOrder?: number
  icon?: ReactNode
  navHidden?: boolean
  // Dynamic flags
  visible?: (ctx: RouteVisibilityContext) => boolean | Promise<boolean>
  enabled?: (ctx: RouteVisibilityContext) => boolean | Promise<boolean>
  // Optional static breadcrumb trail for header
  breadcrumb?: Array<{ label: string; labelKey?: string; href?: string }>
  // Navigation context for tiered navigation:
  // - 'main' (default): Main sidebar business operations
  // - 'admin': Collapsible "Settings & Admin" section at bottom of sidebar
  // - 'settings': Hidden from sidebar, only accessible via Settings hub page
  // - 'profile': Profile dropdown items
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
  placement?: {
    section: string
    sectionLabel?: string
    sectionLabelKey?: string
    order?: number
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiHandler = (req: Request, ctx?: any) => Promise<Response> | Response

export type ModuleSubscriberHandler = (
  payload: any,
  ctx: any
) => Promise<void | SyncCrudEventResult> | void | SyncCrudEventResult

export type ModuleWorkerHandler = (job: unknown, ctx: unknown) => Promise<void> | void

export type ModuleRoute = {
  pattern?: string
  path?: string
  requireAuth?: boolean
  /** @deprecated Use `requireFeatures` instead — role names are mutable and can be spoofed */
  requireRoles?: string[]
  // Optional fine-grained feature requirements
  requireFeatures?: string[]
  // Portal: require customer (portal user) authentication instead of staff auth
  requireCustomerAuth?: boolean
  // Portal: require customer-specific features (checked against CustomerRbacService)
  requireCustomerFeatures?: string[]
  // Portal: optional sidebar presentation hint (auto-listed by portal nav endpoint)
  nav?: PortalNavMetadata
  title?: string
  titleKey?: string
  group?: string
  groupKey?: string
  icon?: ReactNode
  order?: number
  priority?: number
  navHidden?: boolean
  visible?: (ctx: RouteVisibilityContext) => boolean | Promise<boolean>
  enabled?: (ctx: RouteVisibilityContext) => boolean | Promise<boolean>
  breadcrumb?: Array<{ label: string; labelKey?: string; href?: string }>
  pageContext?: 'main' | 'admin' | 'settings' | 'profile'
  placement?: {
    section: string
    sectionLabel?: string
    sectionLabelKey?: string
    order?: number
  }
  Component: (props: any) => ReactNode | Promise<ReactNode>
}

export type ModuleApiLegacy = {
  method: HttpMethod
  path: string
  handler: ApiHandler
  metadata?: Record<string, unknown>
  docs?: OpenApiMethodDoc
}

export type ModuleApiRouteFile = {
  path: string
  handlers: Partial<Record<HttpMethod, ApiHandler>>
  requireAuth?: boolean
  /** @deprecated Use `requireFeatures` instead — role names are mutable and can be spoofed */
  requireRoles?: string[]
  // Optional fine-grained feature requirements for the entire route file
  // Note: per-method feature requirements should be expressed inside metadata
  requireFeatures?: string[]
  docs?: OpenApiRouteDoc
  metadata?: Partial<Record<HttpMethod, unknown>>
}

export type ModuleApi = ModuleApiLegacy | ModuleApiRouteFile

export type RouteMatchParams = Record<string, string | string[]>

export type FrontendRouteManifestEntry = Omit<ModuleRoute, 'Component'> & {
  moduleId: string
  load: () => Promise<ModuleRoute['Component']>
}

export type BackendRouteManifestEntry = Omit<ModuleRoute, 'Component'> & {
  moduleId: string
  load: () => Promise<ModuleRoute['Component']>
}

export type ApiRouteManifestEntry = {
  moduleId: string
  kind: 'route-file' | 'legacy'
  path: string
  methods: HttpMethod[]
  method?: HttpMethod
  load: () => Promise<Record<string, unknown>>
}

export type ModuleCli = {
  command: string
  run: (argv: string[]) => Promise<void> | void
}

export type ModuleSubscriber = {
  id: string
  event: string
  persistent?: boolean
  sync?: boolean
  priority?: number
  handler: ModuleSubscriberHandler
}

export type ModuleWorker = {
  id: string
  queue: string
  concurrency: number
  handler: ModuleWorkerHandler
}

export type ModuleInfo = {
  name?: string
  title?: string
  version?: string
  description?: string
  author?: string
  license?: string
  homepage?: string
  copyright?: string
  // Optional hard dependencies: module ids that must be enabled
  requires?: string[]
  // Whether this module can be ejected into the app's src/modules/ for customization
  ejectable?: boolean
}

export type ModuleDashboardWidgetEntry = {
  moduleId: string
  key: string
  source: 'app' | 'package'
  loader: () => Promise<DashboardWidgetModule<any>>
}

export type ModuleInjectionWidgetEntry = {
  moduleId: string
  key: string
  source: 'app' | 'package'
  loader: () => Promise<InjectionAnyWidgetModule<any, any>>
}

export type Module = {
  id: string
  info?: ModuleInfo
  backendRoutes?: ModuleRoute[]
  frontendRoutes?: ModuleRoute[]
  apis?: ModuleApi[]
  cli?: ModuleCli[]
  translations?: Record<string, Record<string, string>>
  // Optional: per-module feature declarations discovered from acl.ts (module root)
  features?: Array<{ id: string; title: string; module: string }>
  // Auto-discovered event subscribers
  subscribers?: ModuleSubscriber[]
  // Auto-discovered queue workers
  workers?: ModuleWorker[]
  // Optional: per-module declared entity extensions and custom fields (static)
  // Extensions discovered from data/extensions.ts; Custom fields discovered from ce.ts (entities[].fields)
  entityExtensions?: import('./entities').EntityExtension[]
  customFieldSets?: import('./entities').CustomFieldSet[]
  // Optional: per-module declared custom entities (virtual/logical entities)
  // Discovered from ce.ts (module root). Each entry represents an entityId with optional label/description.
  customEntities?: Array<{ id: string; label?: string; description?: string }>
  dashboardWidgets?: ModuleDashboardWidgetEntry[]
  injectionWidgets?: ModuleInjectionWidgetEntry[]
  injectionTable?: ModuleInjectionTable
  // Optional: per-module vector search configuration (discovered from vector.ts)
  vector?: import('./vector').VectorModuleConfig
  // Optional: module-specific tenant setup configuration (from setup.ts)
  setup?: import('./setup').ModuleSetupConfig
  // Optional: default encryption maps owned by the module (from encryption.ts)
  defaultEncryptionMaps?: import('./encryption').ModuleEncryptionMap[]
  // Optional: integration marketplace declarations discovered from integration.ts
  integrations?: IntegrationDefinition[]
  bundles?: IntegrationBundle[]
}

function normPath(s: string) {
  return (s.startsWith('/') ? s : '/' + s).replace(/\/+$/, '') || '/'
}

export function matchRoutePattern(pattern: string, pathname: string): RouteMatchParams | undefined {
  const p = normPath(pattern)
  const u = normPath(pathname)
  const pSegs = p.split('/').slice(1)
  const uSegs = u.split('/').slice(1)
  const params: Record<string, string | string[]> = {}
  let i = 0
  for (let j = 0; j < pSegs.length; j++, i++) {
    const seg = pSegs[j]
    const mCatchAll = seg.match(/^\[\.\.\.(.+)\]$/)
    const mOptCatch = seg.match(/^\[\[\.\.\.(.+)\]\]$/)
    const mDyn = seg.match(/^\[(.+)\]$/)
    if (mCatchAll) {
      const key = mCatchAll[1]
      if (i >= uSegs.length) return undefined
      params[key] = uSegs.slice(i)
      i = uSegs.length
      return i === uSegs.length ? params : undefined
    } else if (mOptCatch) {
      const key = mOptCatch[1]
      params[key] = i < uSegs.length ? uSegs.slice(i) : []
      i = uSegs.length
      return params
    } else if (mDyn) {
      if (i >= uSegs.length) return undefined
      params[mDyn[1]] = uSegs[i]
    } else {
      if (i >= uSegs.length || uSegs[i].toLowerCase() !== seg.toLowerCase()) return undefined
    }
  }
  if (i !== uSegs.length) return undefined
  return params
}

function getPattern(r: ModuleRoute) {
  return r.pattern ?? r.path ?? '/'
}

export function findFrontendMatch(modules: Module[], pathname: string): { route: ModuleRoute; params: Record<string, string | string[]> } | undefined {
  for (const m of modules) {
    const routes = m.frontendRoutes ?? []
    for (const r of routes) {
      const params = matchRoutePattern(getPattern(r), pathname)
      if (params) return { route: r, params }
    }
  }
}

export function findBackendMatch(modules: Module[], pathname: string): { route: ModuleRoute; params: Record<string, string | string[]> } | undefined {
  for (const m of modules) {
    const routes = m.backendRoutes ?? []
    for (const r of routes) {
      const params = matchRoutePattern(getPattern(r), pathname)
      if (params) return { route: r, params }
    }
  }
}

export function findApi(modules: Module[], method: HttpMethod, pathname: string): { handler: ApiHandler; params: Record<string, string | string[]>; requireAuth?: boolean; requireRoles?: string[]; metadata?: any } | undefined {
  for (const m of modules) {
    const apis = m.apis ?? []
    for (const a of apis) {
      if ('handlers' in a) {
        const params = matchRoutePattern(a.path, pathname)
        const handler = (a.handlers as any)[method]
        if (params && handler) return { handler, params, requireAuth: a.requireAuth, requireRoles: (a as any).requireRoles, metadata: (a as any).metadata }
      } else {
        const al = a as ModuleApiLegacy
        if (al.method !== method) continue
        const params = matchRoutePattern(al.path, pathname)
        if (params) {
          return { handler: al.handler, params, metadata: al.metadata }
        }
      }
    }
  }
}

export function findRouteManifestMatch<T extends { pattern?: string; path?: string }>(
  routes: T[],
  pathname: string
): { route: T; params: RouteMatchParams } | undefined {
  for (const route of routes) {
    const params = matchRoutePattern(route.pattern ?? route.path ?? '/', pathname)
    if (params) {
      return { route, params }
    }
  }
}

export function findApiRouteManifestMatch<T extends { path: string; methods: HttpMethod[] }>(
  routes: T[],
  method: HttpMethod,
  pathname: string
): { route: T; params: RouteMatchParams } | undefined {
  for (const route of routes) {
    if (!route.methods.includes(method)) continue
    const params = matchRoutePattern(route.path, pathname)
    if (params) {
      return { route, params }
    }
  }
}

let _backendRouteManifests: BackendRouteManifestEntry[] | null = null

export function registerBackendRouteManifests(routes: BackendRouteManifestEntry[]) {
  _backendRouteManifests = routes
}

export function getBackendRouteManifests(): BackendRouteManifestEntry[] {
  return _backendRouteManifests ?? []
}

let _frontendRouteManifests: FrontendRouteManifestEntry[] | null = null

export function registerFrontendRouteManifests(routes: FrontendRouteManifestEntry[]) {
  _frontendRouteManifests = routes
}

export function getFrontendRouteManifests(): FrontendRouteManifestEntry[] {
  return _frontendRouteManifests ?? []
}

let _apiRouteManifests: ApiRouteManifestEntry[] | null = null

export function registerApiRouteManifests(routes: ApiRouteManifestEntry[]) {
  _apiRouteManifests = routes
}

export function getApiRouteManifests(): ApiRouteManifestEntry[] {
  return _apiRouteManifests ?? []
}

// CLI modules registry - shared between CLI and module workers
let _cliModules: Module[] | null = null

export function registerCliModules(modules: Module[]) {
  if (_cliModules !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] CLI modules re-registered (this may occur during HMR)')
  }
  _cliModules = modules
}

export function getCliModules(): Module[] {
  // Return empty array if not registered - allows generate command to work without bootstrap
  return _cliModules ?? []
}

export function hasCliModules(): boolean {
  return _cliModules !== null && _cliModules.length > 0
}

export function getDefaultEncryptionMaps(modules: Module[]): import('./encryption').ModuleEncryptionMap[] {
  const byEntityId = new Map<string, { moduleId: string; map: import('./encryption').ModuleEncryptionMap }>()

  for (const mod of modules) {
    for (const entry of mod.defaultEncryptionMaps ?? []) {
      const previous = byEntityId.get(entry.entityId)
      if (previous) {
        throw new Error(
          `[registry] Duplicate default encryption map for "${entry.entityId}" declared by "${previous.moduleId}" and "${mod.id}"`
        )
      }
      byEntityId.set(entry.entityId, {
        moduleId: mod.id,
        map: {
          entityId: entry.entityId,
          fields: entry.fields.map((field) => ({
            field: field.field,
            hashField: field.hashField ?? null,
          })),
        },
      })
    }
  }

  return Array.from(byEntityId.values(), ({ map }) => map)
}

function ensureLazyHandler<T extends (...args: any[]) => any>(
  loaded: unknown,
  kind: 'subscriber' | 'worker',
  id: string
): T {
  const handler = typeof loaded === 'function'
    ? loaded
    : loaded && typeof loaded === 'object' && 'default' in loaded
      ? (loaded as Record<string, unknown>).default
      : null
  if (typeof handler !== 'function') {
    throw new Error(`[registry] Invalid ${kind} module "${id}" (missing default export handler)`)
  }
  return handler as T
}

export function createLazyModuleSubscriber(
  loadModule: () => Promise<unknown>,
  id: string
): ModuleSubscriberHandler {
  let handlerPromise: Promise<ModuleSubscriberHandler> | null = null
  return async (payload, ctx) => {
    handlerPromise ??= loadModule().then((loaded) =>
      ensureLazyHandler<ModuleSubscriberHandler>(loaded, 'subscriber', id)
    )
    const handler = await handlerPromise
    return handler(payload, ctx)
  }
}

export function createLazyModuleWorker(
  loadModule: () => Promise<unknown>,
  id: string
): ModuleWorkerHandler {
  let handlerPromise: Promise<ModuleWorkerHandler> | null = null
  return async (job, ctx) => {
    handlerPromise ??= loadModule().then((loaded) =>
      ensureLazyHandler<ModuleWorkerHandler>(loaded, 'worker', id)
    )
    const handler = await handlerPromise
    return handler(job, ctx)
  }
}
