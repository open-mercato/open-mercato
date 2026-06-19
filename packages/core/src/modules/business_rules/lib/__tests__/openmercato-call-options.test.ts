import { dedupeOpenMercatoEndpointOptions } from '../openmercato-call-options'
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
})
