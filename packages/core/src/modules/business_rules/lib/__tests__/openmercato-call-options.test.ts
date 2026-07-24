import {
  collectOpenMercatoEndpointOptionsFromDocument,
  dedupeOpenMercatoEndpointOptions,
} from '../openmercato-call-options'
import type { OpenMercatoEndpointOption } from '../openmercato-call-options-types'

describe('OpenMercato call options', () => {
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
