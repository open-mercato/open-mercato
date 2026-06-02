/**
 * @jest-environment node
 */
import {
  resolveEntityFeatureAccess,
  runWidgetDataBatch,
  type WidgetDataBatchEntry,
} from '../widgetDataBatch'
import type { WidgetDataRequest, WidgetDataResponse } from '../../services/widgetDataService'
import { WidgetDataValidationError } from '../../services/widgetDataService'

function makeRequest(entityType: string): WidgetDataRequest {
  return { entityType, metric: { field: 'id', aggregate: 'count' } }
}

function makeEntry(id: string, entityType: string): WidgetDataBatchEntry {
  return { id, request: makeRequest(entityType) }
}

const response: WidgetDataResponse = {
  value: 1,
  data: [],
  metadata: { fetchedAt: '2026-05-31T00:00:00.000Z', recordCount: 1 },
}

describe('resolveEntityFeatureAccess', () => {
  test('resolves RBAC for the union of required features in a single check', async () => {
    const checkFeatures = jest.fn().mockResolvedValue(true)
    const getRequiredFeatures = (entityType: string) =>
      entityType === 'sales:orders' ? ['sales.view'] : ['customers.view']

    const access = await resolveEntityFeatureAccess(
      ['sales:orders', 'customers:entities', 'sales:orders'],
      getRequiredFeatures,
      checkFeatures,
    )

    expect(checkFeatures).toHaveBeenCalledTimes(1)
    expect([...checkFeatures.mock.calls[0][0]].sort()).toEqual(['customers.view', 'sales.view'])
    expect(access.get('sales:orders')).toBe(true)
    expect(access.get('customers:entities')).toBe(true)
  })

  test('entity types without required features are allowed without an RBAC call', async () => {
    const checkFeatures = jest.fn().mockResolvedValue(true)
    const access = await resolveEntityFeatureAccess(
      ['public:metric'],
      () => null,
      checkFeatures,
    )
    expect(checkFeatures).not.toHaveBeenCalled()
    expect(access.get('public:metric')).toBe(true)
  })

  test('union denial falls back to per-entity-type checks', async () => {
    const checkFeatures = jest
      .fn()
      // union check fails
      .mockResolvedValueOnce(false)
      // per-type: sales allowed, customers denied
      .mockImplementation(async (features: string[]) => features.includes('sales.view'))

    const access = await resolveEntityFeatureAccess(
      ['sales:orders', 'customers:entities'],
      (entityType) => (entityType === 'sales:orders' ? ['sales.view'] : ['customers.view']),
      checkFeatures,
    )

    expect(access.get('sales:orders')).toBe(true)
    expect(access.get('customers:entities')).toBe(false)
    // 1 union check + 2 per-type checks
    expect(checkFeatures).toHaveBeenCalledTimes(3)
  })
})

describe('runWidgetDataBatch', () => {
  test('checks RBAC once for the whole batch and fetches each widget', async () => {
    const checkFeatures = jest.fn().mockResolvedValue(true)
    const fetchOne = jest.fn().mockResolvedValue(response)

    const entries = [
      makeEntry('a', 'sales:orders'),
      makeEntry('b', 'sales:orders'),
      makeEntry('c', 'customers:entities'),
    ]

    const results = await runWidgetDataBatch(entries, {
      getRequiredFeatures: () => ['analytics.view'],
      checkFeatures,
      fetchOne,
      describeError: () => 'error',
    })

    expect(checkFeatures).toHaveBeenCalledTimes(1)
    expect(fetchOne).toHaveBeenCalledTimes(3)
    expect(results).toEqual([
      { id: 'a', ok: true, data: response },
      { id: 'b', ok: true, data: response },
      { id: 'c', ok: true, data: response },
    ])
  })

  test('isolates per-widget failures without failing the batch', async () => {
    const fetchOne = jest.fn(async (request: WidgetDataRequest) => {
      if (request.entityType === 'bad:type') {
        throw new WidgetDataValidationError('Invalid entity type: bad:type')
      }
      return response
    })

    const results = await runWidgetDataBatch(
      [makeEntry('ok', 'sales:orders'), makeEntry('bad', 'bad:type')],
      {
        getRequiredFeatures: () => null,
        checkFeatures: jest.fn().mockResolvedValue(true),
        fetchOne,
        describeError: (error) =>
          error instanceof WidgetDataValidationError ? error.message : 'unexpected',
      },
    )

    expect(results).toEqual([
      { id: 'ok', ok: true, data: response },
      { id: 'bad', ok: false, error: 'Invalid entity type: bad:type' },
    ])
  })

  test('denies forbidden entity types and never fetches them', async () => {
    const fetchOne = jest.fn().mockResolvedValue(response)
    const checkFeatures = jest
      .fn()
      .mockResolvedValueOnce(false) // union fails
      .mockImplementation(async (features: string[]) => features.includes('sales.view'))

    const results = await runWidgetDataBatch(
      [makeEntry('ok', 'sales:orders'), makeEntry('nope', 'secret:entities')],
      {
        getRequiredFeatures: (entityType) =>
          entityType === 'sales:orders' ? ['sales.view'] : ['secret.view'],
        checkFeatures,
        fetchOne,
        describeError: () => 'error',
      },
    )

    expect(results).toEqual([
      { id: 'ok', ok: true, data: response },
      { id: 'nope', ok: false, error: 'Forbidden' },
    ])
    expect(fetchOne).toHaveBeenCalledTimes(1)
    expect(fetchOne).toHaveBeenCalledWith(makeRequest('sales:orders'))
  })
})
