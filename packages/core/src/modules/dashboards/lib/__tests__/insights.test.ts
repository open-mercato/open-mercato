/**
 * @jest-environment node
 */
import { AiModelFactoryError } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import {
  computeInsights,
  validateDigestBullets,
  type ComputeInsightsDeps,
  type InsightMetric,
} from '../insights'
import type { AnalyticsRegistry } from '../../services/analyticsRegistry'
import type { WidgetDataRequest, WidgetDataResponse } from '../../services/widgetDataService'
import type { CacheStrategy } from '@open-mercato/cache'

const RANGE = { from: '2026-06-01', to: '2026-06-30', compare: 'previous_period' as const }
const NOW = new Date('2026-07-02T12:00:00.000Z')

function keyForRequest(request: WidgetDataRequest): InsightMetric['key'] {
  if (request.entityType === 'customers:entities') return 'new_customers'
  if (request.metric.aggregate === 'avg') return 'aov'
  if (request.metric.aggregate === 'count') return 'orders'
  return 'revenue'
}

function response(value: number, previousValue: number | null): WidgetDataResponse {
  return {
    value,
    data: [],
    comparison: previousValue === null
      ? undefined
      : { value: previousValue, change: 0, direction: 'unchanged' },
    metadata: { fetchedAt: NOW.toISOString(), recordCount: 1 },
  }
}

function createRegistry(requiredFeatures: Record<string, string[] | null> = {}): Pick<AnalyticsRegistry, 'getRequiredFeatures'> {
  return {
    getRequiredFeatures: (entityType) => requiredFeatures[entityType] ?? null,
  }
}

function createFetch(values: Record<InsightMetric['key'], { value: number; previousValue: number | null }>) {
  return jest.fn(async (request: WidgetDataRequest): Promise<WidgetDataResponse> => {
    const metric = values[keyForRequest(request)]
    return response(metric.value, metric.previousValue)
  })
}

function createProviderDeps(overrides: Partial<ComputeInsightsDeps> = {}): Pick<ComputeInsightsDeps, 'createModelFactory' | 'generateObject' | 'now'> {
  return {
    now: () => NOW,
    createModelFactory: jest.fn(() => ({
      resolveModel: jest.fn(() => ({
        model: {},
        modelId: 'test-model',
        providerId: 'openai',
        source: 'provider_default',
      })),
    })) as unknown as ComputeInsightsDeps['createModelFactory'],
    generateObject: jest.fn(async () => ({
      object: { bullets: ['Revenue was 200.'] },
      usage: { totalTokens: 1 },
    })) as unknown as ComputeInsightsDeps['generateObject'],
    ...overrides,
  }
}

function createMemoryCache(): CacheStrategy {
  const store = new Map<string, unknown>()
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    has: jest.fn(async (key: string) => store.has(key)),
    delete: jest.fn(async (key: string) => store.delete(key)),
    deleteByTags: jest.fn(async () => 0),
    clear: jest.fn(async () => {
      const size = store.size
      store.clear()
      return size
    }),
    keys: jest.fn(async () => [...store.keys()]),
    stats: jest.fn(async () => ({ size: store.size, expired: 0 })),
  }
}

describe('computeInsights', () => {
  test('computes deterministic deltas and nulls the delta when previous value is zero', async () => {
    const fetchWidgetData = createFetch({
      revenue: { value: 200, previousValue: 100 },
      orders: { value: 12, previousValue: 0 },
      aov: { value: 50, previousValue: 25 },
      new_customers: { value: 5, previousValue: 4 },
    })

    const result = await computeInsights(
      {
        widgetDataService: { fetchWidgetData },
        analyticsRegistry: createRegistry(),
        checkFeatures: jest.fn(async () => true),
        ...createProviderDeps(),
      },
      { tenantId: 'tenant-1', effectiveOrgScope: 'all' },
      RANGE,
    )

    expect(result.metrics).toEqual([
      expect.objectContaining({ key: 'revenue', value: 200, previousValue: 100, deltaPct: 1 }),
      expect.objectContaining({ key: 'orders', value: 12, previousValue: 0, deltaPct: null }),
      expect.objectContaining({ key: 'aov', value: 50, previousValue: 25, deltaPct: 1 }),
      expect.objectContaining({ key: 'new_customers', value: 5, previousValue: 4, deltaPct: 0.25 }),
    ])
  })

  test("compare='none' omits previous values and deltas", async () => {
    const fetchWidgetData = createFetch({
      revenue: { value: 200, previousValue: 100 },
      orders: { value: 12, previousValue: 11 },
      aov: { value: 50, previousValue: 25 },
      new_customers: { value: 5, previousValue: 4 },
    })

    const result = await computeInsights(
      {
        widgetDataService: { fetchWidgetData },
        analyticsRegistry: createRegistry(),
        checkFeatures: jest.fn(async () => true),
        ...createProviderDeps(),
      },
      { tenantId: 'tenant-1', effectiveOrgScope: 'all' },
      { ...RANGE, compare: 'none' },
    )

    expect(result.metrics).toHaveLength(4)
    expect(result.metrics.every((metric) => metric.previousValue === null && metric.deltaPct === null)).toBe(true)
    expect(fetchWidgetData.mock.calls.every(([request]) => !request.comparison)).toBe(true)
  })

  test('omits unauthorized entity metrics before building the digest prompt', async () => {
    const generateObject = jest.fn(async () => ({
      object: { bullets: ['Revenue was 200.'] },
      usage: { totalTokens: 1 },
    })) as unknown as ComputeInsightsDeps['generateObject']

    const result = await computeInsights(
      {
        widgetDataService: {
          fetchWidgetData: createFetch({
            revenue: { value: 200, previousValue: 100 },
            orders: { value: 12, previousValue: 10 },
            aov: { value: 50, previousValue: 40 },
            new_customers: { value: 5, previousValue: 4 },
          }),
        },
        analyticsRegistry: createRegistry({
          'sales:orders': ['sales.orders.view'],
          'customers:entities': ['customers.entities.view'],
        }),
        checkFeatures: jest.fn(async (features: string[]) => features.every((feature) => feature.startsWith('sales.'))),
        ...createProviderDeps({ generateObject }),
      },
      { tenantId: 'tenant-1', effectiveOrgScope: 'all' },
      RANGE,
    )

    expect(result.metrics.map((metric) => metric.key)).toEqual(['revenue', 'orders', 'aov'])
    const prompt = (generateObject as jest.Mock).mock.calls[0][0].prompt as string
    expect(prompt).toContain('"revenue"')
    expect(prompt).not.toContain('new_customers')
    expect(prompt).not.toContain('New customers')
  })

  test('keeps metrics and disables AI when no provider is configured', async () => {
    const result = await computeInsights(
      {
        widgetDataService: {
          fetchWidgetData: createFetch({
            revenue: { value: 200, previousValue: 100 },
            orders: { value: 12, previousValue: 10 },
            aov: { value: 50, previousValue: 40 },
            new_customers: { value: 5, previousValue: 4 },
          }),
        },
        analyticsRegistry: createRegistry(),
        checkFeatures: jest.fn(async () => true),
        now: () => NOW,
        createModelFactory: jest.fn(() => {
          throw new AiModelFactoryError('no_provider_configured', 'No provider')
        }) as unknown as ComputeInsightsDeps['createModelFactory'],
      },
      { tenantId: 'tenant-1', effectiveOrgScope: 'all' },
      RANGE,
    )

    expect(result.metrics).toHaveLength(4)
    expect(result.digest).toBeNull()
    expect(result.aiAvailable).toBe(false)
  })

  test('drops all fabricated digest bullets while keeping AI availability when provider resolution succeeded', async () => {
    const result = await computeInsights(
      {
        widgetDataService: {
          fetchWidgetData: createFetch({
            revenue: { value: 200, previousValue: 100 },
            orders: { value: 12, previousValue: 10 },
            aov: { value: 50, previousValue: 40 },
            new_customers: { value: 5, previousValue: 4 },
          }),
        },
        analyticsRegistry: createRegistry(),
        checkFeatures: jest.fn(async () => true),
        ...createProviderDeps({
          generateObject: jest.fn(async () => ({
            object: { bullets: ['Revenue mysteriously reached 777.'] },
            usage: { totalTokens: 1 },
          })) as unknown as ComputeInsightsDeps['generateObject'],
        }),
      },
      { tenantId: 'tenant-1', effectiveOrgScope: 'all' },
      RANGE,
    )

    expect(result.digest).toBeNull()
    expect(result.aiAvailable).toBe(true)
  })

  test('returns cached metrics on the second identical call and skips widget recompute', async () => {
    const cache = createMemoryCache()
    const fetchWidgetData = createFetch({
      revenue: { value: 200, previousValue: 100 },
      orders: { value: 12, previousValue: 10 },
      aov: { value: 50, previousValue: 40 },
      new_customers: { value: 5, previousValue: 4 },
    })
    const deps: ComputeInsightsDeps = {
      widgetDataService: { fetchWidgetData },
      analyticsRegistry: createRegistry(),
      checkFeatures: jest.fn(async () => true),
      cache,
      now: () => NOW,
      createModelFactory: jest.fn(() => {
        throw new AiModelFactoryError('no_provider_configured', 'No provider')
      }) as unknown as ComputeInsightsDeps['createModelFactory'],
    }

    const first = await computeInsights(deps, { tenantId: 'tenant-1', effectiveOrgScope: 'all' }, RANGE)
    const second = await computeInsights(deps, { tenantId: 'tenant-1', effectiveOrgScope: 'all' }, RANGE)

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.metrics).toEqual(first.metrics)
    expect(fetchWidgetData).toHaveBeenCalledTimes(4)
  })

  test('threads the caller locale and translated labels into the digest prompt', async () => {
    const generateObject = jest.fn(async () => ({
      object: { bullets: ['Przychód wyniósł 200.'] },
      usage: { totalTokens: 1 },
    })) as unknown as ComputeInsightsDeps['generateObject']

    await computeInsights(
      {
        widgetDataService: {
          fetchWidgetData: createFetch({
            revenue: { value: 200, previousValue: 100 },
            orders: { value: 12, previousValue: 10 },
            aov: { value: 50, previousValue: 40 },
            new_customers: { value: 5, previousValue: 4 },
          }),
        },
        analyticsRegistry: createRegistry(),
        checkFeatures: jest.fn(async () => true),
        ...createProviderDeps({ generateObject }),
        locale: 'pl',
        translate: (key: string) => (key.endsWith('.revenue') ? 'Przychód' : key),
      },
      { tenantId: 'tenant-1', effectiveOrgScope: 'all' },
      RANGE,
    )

    const prompt = (generateObject as jest.Mock).mock.calls[0][0].prompt as string
    expect(prompt).toContain('Polish')
    expect(prompt).toContain('locale pl')
    expect(prompt).toContain('Przychód')
  })

  test('does not share a cached digest across locales', async () => {
    const cache = createMemoryCache()
    const baseDeps = {
      widgetDataService: {
        fetchWidgetData: createFetch({
          revenue: { value: 200, previousValue: 100 },
          orders: { value: 12, previousValue: 10 },
          aov: { value: 50, previousValue: 40 },
          new_customers: { value: 5, previousValue: 4 },
        }),
      },
      analyticsRegistry: createRegistry(),
      checkFeatures: jest.fn(async () => true),
      cache,
    }
    const enGenerate = jest.fn(async () => ({ object: { bullets: [] }, usage: { totalTokens: 1 } })) as unknown as ComputeInsightsDeps['generateObject']
    const plGenerate = jest.fn(async () => ({ object: { bullets: [] }, usage: { totalTokens: 1 } })) as unknown as ComputeInsightsDeps['generateObject']
    const scope = { tenantId: 'tenant-1', effectiveOrgScope: 'all' as const }

    await computeInsights({ ...baseDeps, ...createProviderDeps({ generateObject: enGenerate }), locale: 'en' }, scope, RANGE)
    await computeInsights({ ...baseDeps, ...createProviderDeps({ generateObject: plGenerate }), locale: 'pl' }, scope, RANGE)

    expect(enGenerate).toHaveBeenCalledTimes(1)
    expect(plGenerate).toHaveBeenCalledTimes(1)
  })
})

describe('validateDigestBullets', () => {
  const metrics: InsightMetric[] = [
    {
      key: 'revenue',
      label: 'dashboards.widgets.aiInsights.metrics.revenue',
      value: 1234,
      previousValue: 1000,
      deltaPct: 0.12,
    },
  ]

  test('keeps payload numbers with thousands, percentage, and compact formatting', () => {
    expect(validateDigestBullets([
      'Revenue reached 1,234.',
      'Revenue increased by 12%.',
      'Revenue rounded to 1.2k.',
    ], metrics)).toEqual([
      'Revenue reached 1,234.',
      'Revenue increased by 12%.',
      'Revenue rounded to 1.2k.',
    ])
  })

  test('drops fabricated numbers', () => {
    expect(validateDigestBullets([
      'Revenue reached 1,234.',
      'Revenue also reached 777.',
    ], metrics)).toEqual(['Revenue reached 1,234.'])
  })
})
