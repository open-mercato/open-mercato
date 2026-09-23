import type { EntityManager } from '@mikro-orm/postgresql'
import { createWmsAvailabilityProvider } from '../availabilityProvider'
import {
  availabilityProviderRegistry,
  resolveAvailability,
  AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
} from '@open-mercato/shared/lib/availability'
import type { AvailabilityModuleConfigReader, AvailabilityQuery } from '@open-mercato/shared/lib/availability'
// Import side effect self-registers the built-in catalog-only fallback (mirrors the app
// barrel `@open-mercato/shared/lib/availability`'s own index.ts behaviour).
import '@open-mercato/shared/lib/availability'

function makeEm(): EntityManager {
  const execute = jest.fn().mockResolvedValue([])
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  ;(em as unknown as { fork: () => EntityManager }).fork = () => em
  return em
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
    const provider = createWmsAvailabilityProvider(makeContainer(makeEm()))
    expect(provider.id).toBe('wms')
  })

  it('getAvailability computes a live, coherent result', async () => {
    const provider = createWmsAvailabilityProvider(makeContainer(makeEm()))
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
        const byItem: Record<string, any> = {}
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
    availabilityProviderRegistry.register(createWmsAvailabilityProvider(makeContainer(makeEm())))
    const result = await resolveAvailability(makeQuery())
    // wms's own provider ran (an actual sellable computation), not the catalog-only stub.
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
    expect(result.byItem['p1:v1'].isAuthoritative).toBe(true)
  })

  it('an explicit selectedProvider of "wms" resolves through wms', async () => {
    availabilityProviderRegistry.register(createWmsAvailabilityProvider(makeContainer(makeEm())))
    const moduleConfig: AvailabilityModuleConfigReader = { getValue: async () => 'wms' }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['p1:v1'].state).toBe('out_of_stock')
  })

  it('an explicit selectedProvider of "catalog-only" bypasses wms even when it is registered', async () => {
    availabilityProviderRegistry.register({
      id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
      getAvailability: async () => ({ byItem: { 'p1:v1': { state: 'not_tracked', availableQuantity: null, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null } } }),
    })
    availabilityProviderRegistry.register(createWmsAvailabilityProvider(makeContainer(makeEm())))
    const moduleConfig: AvailabilityModuleConfigReader = { getValue: async () => 'catalog-only' }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['p1:v1'].state).toBe('not_tracked')
  })

  it('falls back to catalog-only when the selected provider id is not registered', async () => {
    availabilityProviderRegistry.register({
      id: AVAILABILITY_CATALOG_ONLY_PROVIDER_ID,
      getAvailability: async () => ({ byItem: { 'p1:v1': { state: 'not_tracked', availableQuantity: null, canFulfil: true, leadTimeDays: null, releaseAt: null, isAuthoritative: true, policySourceId: null } } }),
    })
    const moduleConfig: AvailabilityModuleConfigReader = { getValue: async () => 'wms' }
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

    availabilityProviderRegistry.register(createWmsAvailabilityProvider(makeContainer(em)))
    // Hand-computed: sellable = 50 - 10 (once) = 40.
    const atLimit = await resolveAvailability(makeQuery({ items: [{ catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 40 }] }))
    expect(atLimit.byItem['p1:v1'].state).toBe('in_stock')
    expect(atLimit.byItem['p1:v1'].availableQuantity).toBe(40)

    const overLimit = await resolveAvailability(makeQuery({ items: [{ catalogProductId: 'p1', catalogVariantId: 'v1', quantity: 41 }] }))
    expect(overLimit.byItem['p1:v1'].state).toBe('out_of_stock')
  })
})
