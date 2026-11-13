import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import {
  collectOpenMercatoEndpointOptionsFromDocument,
  dedupeOpenMercatoEndpointOptions,
  findOpenMercatoEndpointOption,
  getCurrentOpenMercatoEndpointOptions,
} from '../openmercato-call-options'
import type { OpenMercatoEndpointOption } from '../openmercato-call-options-types'

type RouteRegistryModule = typeof import('@open-mercato/shared/modules/registry')

function loadApiBundleRouteRegistry(): RouteRegistryModule {
  let loaded: RouteRegistryModule | null = null
  jest.isolateModules(() => {
    loaded = require('@open-mercato/shared/modules/registry') as RouteRegistryModule
  })
  if (!loaded) throw new Error('[internal] route registry failed to load')
  return loaded
}

describe('OpenMercato call options', () => {
  afterEach(() => {
    loadApiBundleRouteRegistry().registerApiRouteManifests([])
  })

  test('resolves endpoints registered by the API bundle when the page bundle bootstrapped modules without apis', async () => {
    registerModules([{ id: 'customers' }])
    const companiesRoute: ApiRouteManifestEntry = {
      moduleId: 'customers',
      kind: 'route-file',
      path: '/customers/companies',
      methods: ['GET', 'PUT'],
      load: async () => ({
        openApi: { methods: { PUT: { summary: 'Update company' } } },
      }),
    }
    loadApiBundleRouteRegistry().registerApiRouteManifests([companiesRoute])

    const options = await getCurrentOpenMercatoEndpointOptions()

    expect(findOpenMercatoEndpointOption('/api/customers/companies', 'PUT', options)).toMatchObject({
      id: 'PUT /api/customers/companies',
      summary: 'Update company',
    })
  })

  test('deduplicates endpoint options by method and path id', () => {
    const options: OpenMercatoEndpointOption[] = [
      {
        id: 'GET /api/example/items',
        path: '/api/example/items',
        method: 'GET',
        label: 'GET /api/example/items',
        summary: null,
        operationId: null,
      },
      {
        id: 'GET /api/example/items',
        path: '/api/example/items',
        method: 'GET',
        label: 'GET /api/example/items - List example items',
        summary: 'List example items',
        operationId: 'listExampleItems',
      },
      {
        id: 'POST /api/example/items',
        path: '/api/example/items',
        method: 'POST',
        label: 'POST /api/example/items',
        summary: null,
        operationId: null,
      },
    ]

    expect(dedupeOpenMercatoEndpointOptions(options)).toEqual([
      {
        id: 'GET /api/example/items',
        path: '/api/example/items',
        method: 'GET',
        label: 'GET /api/example/items - List example items',
        summary: 'List example items',
        operationId: 'listExampleItems',
      },
      {
        id: 'POST /api/example/items',
        path: '/api/example/items',
        method: 'POST',
        label: 'POST /api/example/items',
        summary: null,
        operationId: null,
      },
    ])
  })

  test('excludes docs, options, path-parameter, and deprecated endpoints from OpenAPI documents', () => {
    const options = collectOpenMercatoEndpointOptionsFromDocument({
      paths: {
        '/api/currencies/currencies': {
          get: { summary: 'List currencies' },
        },
        '/api/currencies/currencies/options': {
          get: { summary: 'List currency options' },
        },
        '/api/docs/openapi': {
          get: { summary: 'OpenAPI docs' },
        },
        '/api/currencies/currencies/{id}': {
          get: { summary: 'Read currency' },
        },
        '/api/currencies/deprecated': {
          get: { summary: 'Deprecated currencies', deprecated: true },
        },
      },
    })

    expect(options.map((option) => option.id)).toEqual(['GET /api/currencies/currencies'])
  })
})
