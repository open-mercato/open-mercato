import { createLogger } from '@open-mercato/shared/lib/logger'
import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  getApiRouteManifests,
  getBackendRouteManifests,
  type ApiRouteManifestEntry,
  type HttpMethod,
  type Module,
} from '@open-mercato/shared/modules/registry'

const logger = createLogger('auth').child({ component: 'gated-surface' })

/**
 * The feature-gated surface of the running app, read from the app registries: backend pages
 * (`requireFeatures` on the page), the navigation entries among them (a static path that is not
 * `navHidden`, as `buildAdminNav` lists them) and API route methods (`requireFeatures` of the
 * method's metadata, as the API router reads it). Widgets, AI tools and webhooks are not part of
 * it. Server-only; computed once per registered manifest set.
 */
export type GatedSurfaceKind = 'page' | 'menu_item' | 'api_route'

export type GatedSurfaceItem = {
  kind: GatedSurfaceKind
  id: string
  requiredFeatures: string[]
}

export type GatedSurface = {
  items: GatedSurfaceItem[]
  pagesAvailable: boolean
  apiRoutesAvailable: boolean
}

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const API_LOAD_CONCURRENCY = 16

/** How long a request waits for the API route metadata the first time (it keeps loading afterwards). */
export const GATED_SURFACE_API_WAIT_MS = 5_000

type RouteLike = {
  pattern?: string
  path?: string
  requireFeatures?: readonly string[] | null
  navHidden?: boolean
}

function readFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((feature): feature is string => typeof feature === 'string' && feature.length > 0)))
}

/** The page and navigation entries of backend routes that require features. */
export function collectPageItems(routes: readonly RouteLike[]): GatedSurfaceItem[] {
  const items = new Map<string, GatedSurfaceItem>()
  for (const route of routes) {
    const href = route.pattern ?? route.path ?? ''
    const requiredFeatures = readFeatures(route.requireFeatures)
    if (!href || requiredFeatures.length === 0) continue
    const pageKey = `page:${href}`
    if (!items.has(pageKey)) items.set(pageKey, { kind: 'page', id: href, requiredFeatures })
    if (!href.includes('[') && route.navHidden !== true) {
      const menuKey = `menu_item:${href}`
      if (!items.has(menuKey)) items.set(menuKey, { kind: 'menu_item', id: href, requiredFeatures })
    }
  }
  return Array.from(items.values())
}

/** The `requireFeatures` of one method, read like the API router reads route metadata. */
export function readMethodFeatures(metadata: unknown, method: HttpMethod): string[] {
  if (!metadata || typeof metadata !== 'object') return []
  const record = metadata as Record<string, unknown>
  const entry = record[method]
  const source = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : record
  return readFeatures(source.requireFeatures)
}

function legacyMetadata(metadata: unknown, method: HttpMethod): unknown {
  if (!metadata || typeof metadata !== 'object') return metadata
  const record = metadata as Record<string, unknown>
  return HTTP_METHODS.some((entryMethod) => entryMethod in record) ? metadata : { [method]: metadata }
}

function apiItem(path: string, method: HttpMethod, metadata: unknown): GatedSurfaceItem | null {
  const requiredFeatures = readMethodFeatures(metadata, method)
  return requiredFeatures.length > 0 ? { kind: 'api_route', id: `${method} ${path}`, requiredFeatures } : null
}

/** API route methods of the module registry (populated with route metadata in tests and CLI processes). */
export function collectModuleApiItems(modules: readonly Module[]): GatedSurfaceItem[] {
  const items: GatedSurfaceItem[] = []
  for (const mod of modules) {
    for (const api of mod.apis ?? []) {
      if ('handlers' in api) {
        for (const method of HTTP_METHODS) {
          if (typeof (api.handlers as Partial<Record<HttpMethod, unknown>>)[method] !== 'function') continue
          const item = apiItem(api.path, method, api.metadata)
          if (item) items.push(item)
        }
      } else {
        const item = apiItem(api.path, api.method, legacyMetadata(api.metadata, api.method))
        if (item) items.push(item)
      }
    }
  }
  return items
}

async function loadManifestApiItems(entries: readonly ApiRouteManifestEntry[]): Promise<{ items: GatedSurfaceItem[]; failed: number }> {
  const items: GatedSurfaceItem[] = []
  let failed = 0
  let cursor = 0
  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor]
      cursor += 1
      try {
        const loaded = await entry.load()
        const metadata = (loaded as { metadata?: unknown }).metadata
        const methods: HttpMethod[] = entry.kind === 'legacy' && entry.method ? [entry.method] : [...entry.methods]
        for (const method of methods) {
          const item = apiItem(entry.path, method, entry.kind === 'legacy' ? legacyMetadata(metadata, method) : metadata)
          if (item) items.push(item)
        }
      } catch (error) {
        failed += 1
        logger.warn('[internal] An API route module could not be loaded for the gated-surface count', { path: entry.path, err: error })
        getTelemetryRuntime()?.reportError(error, { module: 'auth', code: 'auth.gated_surface_route_load_failed', attributes: { path: entry.path } })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(API_LOAD_CONCURRENCY, entries.length) }, () => worker()))
  return { items, failed }
}

type ApiSurfaceCache = {
  manifests: readonly ApiRouteManifestEntry[]
  promise: Promise<GatedSurfaceItem[] | null>
}

let apiSurfaceCache: ApiSurfaceCache | null = null

/**
 * API route items from the registered API route manifests (each route module's `metadata`, loaded
 * once per process and manifest set; `null` when some route could not be loaded), else from the
 * module registry's route metadata, else `null` (not available in this process).
 */
function apiSurface(): Promise<GatedSurfaceItem[] | null> {
  const manifests = getApiRouteManifests()
  if (manifests.length === 0) {
    const modules = tryGetModules() ?? []
    const hasApis = modules.some((mod) => Array.isArray(mod.apis) && mod.apis.length > 0)
    return Promise.resolve(hasApis ? collectModuleApiItems(modules) : null)
  }
  if (apiSurfaceCache && apiSurfaceCache.manifests === manifests) return apiSurfaceCache.promise
  const promise = loadManifestApiItems(manifests).then(({ items, failed }) => (failed > 0 ? null : items))
  apiSurfaceCache = { manifests, promise }
  promise.then((items) => {
    if (items === null && apiSurfaceCache?.promise === promise) apiSurfaceCache = null
  }).catch((error: unknown) => {
    if (apiSurfaceCache?.promise === promise) apiSurfaceCache = null
    getTelemetryRuntime()?.reportError(error, { module: 'auth', code: 'auth.gated_surface_failed' })
  })
  return promise
}

function pageSurface(): GatedSurfaceItem[] | null {
  const manifests = getBackendRouteManifests()
  if (manifests.length > 0) return collectPageItems(manifests)
  const modules = tryGetModules() ?? []
  const routes = modules.flatMap((mod) => mod.backendRoutes ?? [])
  return routes.length > 0 ? collectPageItems(routes) : null
}

/**
 * The gated surface for one request: pages and navigation entries at once; API route methods when
 * their metadata is ready within `waitMs` (else reported unavailable while loading continues).
 */
export async function loadGatedSurface(options: { waitMs?: number } = {}): Promise<GatedSurface> {
  const pages = pageSurface()
  const waitMs = options.waitMs ?? GATED_SURFACE_API_WAIT_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), waitMs)
  })
  let api: GatedSurfaceItem[] | null = null
  try {
    const outcome = await Promise.race([apiSurface(), timeout])
    api = outcome === 'timeout' ? null : outcome
  } catch (error) {
    logger.warn('[internal] The API route surface could not be read', { err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'auth', code: 'auth.gated_surface_failed' })
    api = null
  } finally {
    if (timer) clearTimeout(timer)
  }
  return {
    items: [...(pages ?? []), ...(api ?? [])],
    pagesAvailable: pages !== null,
    apiRoutesAvailable: api !== null,
  }
}

export function resetGatedSurfaceForTests(): void {
  apiSurfaceCache = null
}
