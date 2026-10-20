import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import {
  registerApiRouteManifests,
  registerBackendRouteManifests,
  type ApiRouteManifestEntry,
  type BackendRouteManifestEntry,
  type Module,
} from '@open-mercato/shared/modules/registry'
import {
  collectModuleApiItems,
  collectPageItems,
  loadGatedSurface,
  readMethodFeatures,
  resetGatedSurfaceForTests,
} from '../gatedSurface'
import { findUnknownAclFeatures, isKnownAclFeature } from '../aclCatalog'

function backendRoute(pattern: string, requireFeatures: string[] | undefined, navHidden = false): BackendRouteManifestEntry {
  return { moduleId: 'sales', pattern, requireFeatures, navHidden, load: async () => () => null }
}

function apiRoute(path: string, methods: Array<'GET' | 'POST' | 'PUT'>, load: ApiRouteManifestEntry['load']): ApiRouteManifestEntry {
  return { moduleId: 'sales', kind: 'route-file', path, methods, load }
}

afterEach(() => {
  resetGatedSurfaceForTests()
  registerBackendRouteManifests([])
  registerApiRouteManifests([])
})

describe('gated surface', () => {
  it('counts feature-gated pages, and as navigation entries only static, visible ones', () => {
    const items = collectPageItems([
      { pattern: '/backend/sales/orders', requireFeatures: ['sales.orders.view'] },
      { pattern: '/backend/sales/orders/[id]', requireFeatures: ['sales.orders.view'] },
      { pattern: '/backend/sales/hidden', requireFeatures: ['sales.orders.manage'], navHidden: true },
      { pattern: '/backend/open', requireFeatures: [] },
      { path: '/backend/legacy', requireFeatures: ['sales.quotes.view'] },
    ])
    expect(items).toEqual([
      { kind: 'page', id: '/backend/sales/orders', requiredFeatures: ['sales.orders.view'] },
      { kind: 'menu_item', id: '/backend/sales/orders', requiredFeatures: ['sales.orders.view'] },
      { kind: 'page', id: '/backend/sales/orders/[id]', requiredFeatures: ['sales.orders.view'] },
      { kind: 'page', id: '/backend/sales/hidden', requiredFeatures: ['sales.orders.manage'] },
      { kind: 'page', id: '/backend/legacy', requiredFeatures: ['sales.quotes.view'] },
      { kind: 'menu_item', id: '/backend/legacy', requiredFeatures: ['sales.quotes.view'] },
    ])
  })

  it('reads a method\'s features like the API router: the method entry, else the shared metadata', () => {
    expect(readMethodFeatures({ GET: { requireFeatures: ['a.view'] }, POST: { requireAuth: true } }, 'GET')).toEqual(['a.view'])
    expect(readMethodFeatures({ GET: { requireFeatures: ['a.view'] }, POST: { requireAuth: true } }, 'POST')).toEqual([])
    expect(readMethodFeatures({ requireFeatures: ['a.manage'] }, 'PUT')).toEqual(['a.manage'])
    expect(readMethodFeatures(null, 'GET')).toEqual([])
  })

  it('reads route-file and legacy API metadata of the module registry', () => {
    const modules = [{
      id: 'sales',
      apis: [
        { path: '/sales/orders', handlers: { GET: async () => new Response(), PUT: async () => new Response() }, metadata: { GET: { requireFeatures: ['sales.orders.view'] }, PUT: { requireFeatures: ['sales.orders.manage'] } } },
        { method: 'POST', path: '/sales/legacy', handler: async () => new Response(), metadata: { requireFeatures: ['sales.quotes.view'] } },
      ],
    }] as unknown as Module[]
    expect(collectModuleApiItems(modules)).toEqual([
      { kind: 'api_route', id: 'GET /sales/orders', requiredFeatures: ['sales.orders.view'] },
      { kind: 'api_route', id: 'PUT /sales/orders', requiredFeatures: ['sales.orders.manage'] },
      { kind: 'api_route', id: 'POST /sales/legacy', requiredFeatures: ['sales.quotes.view'] },
    ])
  })

  it('loads the API route metadata of the registered manifests once per manifest set', async () => {
    registerBackendRouteManifests([backendRoute('/backend/sales/orders', ['sales.orders.view'])])
    const load = jest.fn(async () => ({ metadata: { GET: { requireFeatures: ['sales.orders.view'] }, PUT: { requireFeatures: ['sales.orders.manage'] } } }))
    registerApiRouteManifests([apiRoute('/sales/orders', ['GET', 'PUT'], load)])
    const surface = await loadGatedSurface()
    expect(surface.pagesAvailable).toBe(true)
    expect(surface.apiRoutesAvailable).toBe(true)
    expect(surface.items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'page:/backend/sales/orders',
      'menu_item:/backend/sales/orders',
      'api_route:GET /sales/orders',
      'api_route:PUT /sales/orders',
    ])
    await loadGatedSurface()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reports API routes unavailable when a route cannot be loaded or loading outlasts the wait, and pages unavailable without a registry', async () => {
    registerModules([{ id: 'sales' }] as unknown as Module[])
    registerApiRouteManifests([apiRoute('/sales/broken', ['GET'], async () => { throw new Error('boom') })])
    const broken = await loadGatedSurface()
    expect(broken).toEqual({ items: [], pagesAvailable: false, apiRoutesAvailable: false })
    resetGatedSurfaceForTests()
    registerApiRouteManifests([apiRoute('/sales/slow', ['GET'], () => new Promise(() => undefined))])
    const slow = await loadGatedSurface({ waitMs: 10 })
    expect(slow.apiRoutesAvailable).toBe(false)
  })
})

describe('ACL catalog', () => {
  const catalog = new Set(['sales.orders.view', 'sales.orders.manage', 'entities.records.user:task.view'])

  it('knows *, catalog features and wildcards that cover a catalog feature', () => {
    expect(isKnownAclFeature('*', catalog)).toBe(true)
    expect(isKnownAclFeature('sales.orders.view', catalog)).toBe(true)
    expect(isKnownAclFeature('sales.*', catalog)).toBe(true)
    expect(isKnownAclFeature('sales.orders.*', catalog)).toBe(true)
    expect(isKnownAclFeature('sales.order.*', catalog)).toBe(false)
    expect(isKnownAclFeature('.*', catalog)).toBe(false)
    expect(isKnownAclFeature('made.up', catalog)).toBe(false)
  })

  it('checks only the grants a proposal adds', () => {
    expect(findUnknownAclFeatures(['sales.orders.view', 'legacy.kept', 'made.up'], catalog, ['legacy.kept'])).toEqual(['made.up'])
  })
})
