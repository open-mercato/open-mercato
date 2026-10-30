import type { EntityManager } from '@mikro-orm/postgresql'
import { createWmsAvailabilityProvider, wmsAvailabilityProvider } from '../availabilityProvider'
import { register as registerWmsDi } from '../../di'
import {
  availabilityProviderRegistry,
  resolveAvailability,
  AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
} from '@open-mercato/shared/lib/availability'
import type { AvailabilityItemResult, AvailabilityModuleConfigReader, AvailabilityQuery } from '@open-mercato/shared/lib/availability'
// Import side effect self-registers the built-in catalog-only fallback (mirrors the app
// barrel `@open-mercato/shared/lib/availability`'s own index.ts behaviour).
import '@open-mercato/shared/lib/availability'

function makeEm(execute: jest.Mock = makeTrackedExecute()): EntityManager {
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  ;(em as unknown as { fork: () => EntityManager }).fork = () => em
  return em
}

function makeTrackedExecute(): jest.Mock {
  return jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('wms_product_inventory_profiles')) {
      return [{ catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '0', reorder_point: null }]
    }
    return []
  })
}

function makeProvider(em: EntityManager = makeEm()) {
  const container = makeContainer(em)
  return createWmsAvailabilityProvider({ createContainer: async () => container })
}

function makeContainer(em: EntityManager) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'em') return em as unknown as T
      throw new Error(`not registered: ${name}`)
    },
  }
}

function makeQuery(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    items: [{ catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 1 }],
    ...overrides,
  }
}

describe('createWmsAvailabilityProvider', () => {
  it('registers under id "wms"', () => {
    const provider = makeProvider()
    expect(provider.id).toBe('wms')
  })

  it('getAvailability computes a live, coherent result', async () => {
    const provider = makeProvider()
    const result = await provider.getAvailability(makeQuery())
    expect(result.byItem['p1:v1']).toBeDefined()
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].isAuthoritative).toBe(true)
  })
})

describe('resolveAvailability — wms enabled vs disabled (module-decoupling)', () => {
  beforeEach(() => {
    availabilityProviderRegistry.reset()
  })

  it('falls back to catalog-only when wms is not registered (wms disabled)', async () => {
    availabilityProviderRegistry.register({
      id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
      getAvailability: async (query) => {
        const byItem: Record<string, AvailabilityItemResult> = {}
        for (const item of query.items) {
          byItem[`${item.catalogProductId}:${item.catalogVariantId ?? ''}`] = {
            state: 'not_tracked',
            availableQuantity: null,
            canFulfil: true,
            leadTimeDays: null,
            releaseAt: null,
            isAuthoritative: true,
            policySourceId: null,
          }
        }
        return { byItem }
      },
    })
    const result = await resolveAvailability(makeQuery())
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
  })

  it("'auto' selects wms when it is registered (wms enabled)", async () => {
    availabilityProviderRegistry.register({
      id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
      getAvailability: async () => ({ byItem: { 'p1:v1': { state: 'not_tracked', availableQuantity: null, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null } } }),
    })
    availabilityProviderRegistry.register(makeProvider())
    const result = await resolveAvailability(makeQuery())
    // wms's own provider ran (an actual sellable computation), not the catalog-only stub.
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].isAuthoritative).toBe(true)
  })

  it('an explicit selectedProvider of "wms" resolves through wms', async () => {
    availabilityProviderRegistry.register(makeProvider())
    const moduleConfig: AvailabilityModuleConfigReader = { getValue: async <T,>() => 'wms' as T }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
  })

  it('an explicit selectedProvider of "catalog-only" bypasses wms even when it is registered', async () => {
    availabilityProviderRegistry.register({
      id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
      getAvailability: async () => ({ byItem: { 'p1:v1': { state: 'not_tracked', availableQuantity: null, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null } } }),
    })
    availabilityProviderRegistry.register(makeProvider())
    const moduleConfig: AvailabilityModuleConfigReader = { getValue: async <T,>() => 'catalog-only' as T }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
  })

  it('falls back to catalog-only when the selected provider id is not registered', async () => {
    availabilityProviderRegistry.register({
      id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
      getAvailability: async () => ({ byItem: { 'p1:v1': { state: 'not_tracked', availableQuantity: null, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null } } }),
    })
    const moduleConfig: AvailabilityModuleConfigReader = { getValue: async <T,>() => 'wms' as T }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
  })
})

describe('resolveAvailability — coherent states on a seeded multi-location warehouse (Phase 2 Gate)', () => {
  beforeEach(() => {
    availabilityProviderRegistry.reset()
  })

  it('matches hand-computed expectations: 4 locations, safety stock subtracted once, exact-quantity boundary', async () => {
    const em = {
      getConnection: () => ({
        execute: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('wms_inventory_balances')) {
            // 4 locations: 20 + 15 + 10 + 5 = 50 on-hand-equivalent aggregate available.
            return [{ catalog_variant_id: 'v1', aggregate_available: '50' }]
          }
          if (sql.includes('wms_product_inventory_profiles')) {
            return [{ catalog_product_id: 'p1', catalog_variant_id: 'v1', safety_stock: '10', reorder_point: '0' }]
          }
          return []
        }),
      }),
    } as unknown as EntityManager
    ;(em as unknown as { fork: () => EntityManager }).fork = () => em

    availabilityProviderRegistry.register(makeProvider(em))
    // Hand-computed: sellable = 50 - 10 (once) = 40.
    const atLimit = await resolveAvailability(makeQuery({ items: [{ catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 40 }] }))
    expect(atLimit.byItem['p1:v1'].state).toBe('in_stock')
    expect(atLimit.byItem['p1:v1'].availableQuantity).toBe(40)

    const overLimit = await resolveAvailability(makeQuery({ items: [{ catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 41 }] }))
    expect(overLimit.byItem['p1:v1'].state).toBe('out_of_stock')
  })
})

describe('wms provider registration — no container captured across requests', () => {
  beforeEach(() => {
    availabilityProviderRegistry.reset()
  })

  function makeAppContainer(execute: jest.Mock) {
    const em = makeEm(execute)
    return {
      register: jest.fn(),
      resolve: <T,>(name: string): T => {
        if (name === 'em') return em as unknown as T
        throw new Error(`not registered: ${name}`)
      },
    }
  }

  it('registers one stable provider instance however many request containers are built', () => {
    registerWmsDi(makeAppContainer(makeTrackedExecute()) as unknown as Parameters<typeof registerWmsDi>[0])
    registerWmsDi(makeAppContainer(makeTrackedExecute()) as unknown as Parameters<typeof registerWmsDi>[0])
    expect(availabilityProviderRegistry.get('wms')).toBe(wmsAvailabilityProvider)
    expect(availabilityProviderRegistry.list().filter((provider) => provider.id === 'wms')).toHaveLength(1)
  })

  it('resolves dependencies from the calling request container, not the one that registered last', async () => {
    const firstExecute = makeTrackedExecute()
    const secondExecute = makeTrackedExecute()
    const first = makeAppContainer(firstExecute)
    const second = makeAppContainer(secondExecute)
    registerWmsDi(first as unknown as Parameters<typeof registerWmsDi>[0])
    registerWmsDi(second as unknown as Parameters<typeof registerWmsDi>[0])

    await resolveAvailability(makeQuery(), { container: first })
    expect(firstExecute).toHaveBeenCalled()
    expect(secondExecute).not.toHaveBeenCalled()

    const firstCallCount = firstExecute.mock.calls.length
    await resolveAvailability(makeQuery(), { container: second })
    expect(secondExecute).toHaveBeenCalled()
    expect(firstExecute).toHaveBeenCalledTimes(firstCallCount)
  })

  it('builds a fresh container per call when the caller passes none', async () => {
    const createContainer = jest.fn(async () => makeContainer(makeEm()))
    const provider = createWmsAvailabilityProvider({ createContainer })
    await provider.getAvailability(makeQuery())
    await provider.getAvailability(makeQuery())
    expect(createContainer).toHaveBeenCalledTimes(2)
  })

  it('prefers the per-call container over building one', async () => {
    const createContainer = jest.fn(async () => makeContainer(makeEm()))
    const provider = createWmsAvailabilityProvider({ createContainer })
    await provider.getAvailability(makeQuery(), { container: makeContainer(makeEm()) })
    expect(createContainer).not.toHaveBeenCalled()
  })
})
