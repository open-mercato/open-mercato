import { availabilityProviderRegistry, resolveAvailability, AVAILABILITY_CATALOG_ONLY_PROVIDER_ID } from '../registry'
import type { AvailabilityModuleConfigReader } from '../registry'
import type { AvailabilityProvider, AvailabilityQuery, AvailabilityResult } from '../types'

function makeProvider(id: string, result: Partial<AvailabilityResult['byItem'][string]> = {}): AvailabilityProvider {
  return {
    id,
    async getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
      const byItem: AvailabilityResult['byItem'] = {}
      for (const item of query.items) {
        const key = `${item.catalogProductId}:${item.catalogVariantId ?? ''}`
        byItem[key] = {
          state: 'in_stock',
          availableQuantity: 100,
          canFulfil: true,
          leadTimeDays: null,
          releaseAt: null,
          isAuthoritative: true,
          policySourceId: null,
          ...result,
        }
      }
      return { byItem }
    },
  }
}

function makeQuery(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    items: [{ catalogProductId: 'product-1', catalogVariantId: 'variant-1', quantity: 1 }],
    ...overrides,
  }
}

describe('availabilityProviderRegistry', () => {
  beforeEach(() => {
    availabilityProviderRegistry.reset()
  })

  it('registers and retrieves providers by id', () => {
    const provider = makeProvider('alpha')
    availabilityProviderRegistry.register(provider)
    expect(availabilityProviderRegistry.get('alpha')).toBe(provider)
    expect(availabilityProviderRegistry.get('missing')).toBeNull()
  })

  it('is idempotent — replaces by id rather than duplicating', () => {
    const first = makeProvider('alpha')
    const second = makeProvider('alpha')
    availabilityProviderRegistry.register(first)
    availabilityProviderRegistry.register(second)
    expect(availabilityProviderRegistry.list()).toHaveLength(1)
    expect(availabilityProviderRegistry.get('alpha')).toBe(second)
  })

  it('lists providers in registration order', () => {
    availabilityProviderRegistry.register(makeProvider('first'))
    availabilityProviderRegistry.register(makeProvider('second'))
    expect(availabilityProviderRegistry.list().map((p) => p.id)).toEqual(['first', 'second'])
  })

  it('rejects a provider with an empty id', () => {
    expect(() => availabilityProviderRegistry.register({ id: '', getAvailability: async () => ({ byItem: {} }) })).toThrow()
  })
})

describe('resolveAvailability', () => {
  beforeEach(() => {
    availabilityProviderRegistry.reset()
  })

  it('falls back to catalog-only when nothing else is registered and selection is auto', async () => {
    availabilityProviderRegistry.register(makeProvider(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID, { state: 'not_tracked', availableQuantity: null }))
    const result = await resolveAvailability(makeQuery())
    expect(result.byItem['product-1:variant-1'].state).toBe('not_tracked')
  })

  it("'auto' picks the highest-precedence non-catalog-only registrant", async () => {
    availabilityProviderRegistry.register(makeProvider(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID, { state: 'not_tracked' }))
    availabilityProviderRegistry.register(makeProvider('wms', { state: 'in_stock' }))
    const result = await resolveAvailability(makeQuery())
    expect(result.byItem['product-1:variant-1'].state).toBe('in_stock')
  })

  it('honors an explicit selection via the injected module-config reader', async () => {
    availabilityProviderRegistry.register(makeProvider(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID, { state: 'not_tracked' }))
    availabilityProviderRegistry.register(makeProvider('wms', { state: 'in_stock' }))
    const moduleConfig: AvailabilityModuleConfigReader = {
      getValue: async () => 'catalog-only',
    }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['product-1:variant-1'].state).toBe('not_tracked')
  })

  it('falls back to catalog-only when the selected id is not currently registered', async () => {
    availabilityProviderRegistry.register(makeProvider(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID, { state: 'not_tracked' }))
    const moduleConfig: AvailabilityModuleConfigReader = {
      getValue: async () => 'some-unregistered-provider',
    }
    const result = await resolveAvailability(makeQuery(), { moduleConfig })
    expect(result.byItem['product-1:variant-1'].state).toBe('not_tracked')
  })

  it('defaults to auto when the module-config reader is omitted', async () => {
    availabilityProviderRegistry.register(makeProvider('wms', { state: 'in_stock' }))
    const result = await resolveAvailability(makeQuery())
    expect(result.byItem['product-1:variant-1'].state).toBe('in_stock')
  })

  it('throws when no provider is registered at all', async () => {
    await expect(resolveAvailability(makeQuery())).rejects.toThrow()
  })
})
