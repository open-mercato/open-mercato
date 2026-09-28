import '../catalogOnlyProvider'
import { setCatalogOnlyPolicyLookup } from '../catalogOnlyProvider'
import { availabilityProviderRegistry, resolveAvailability, AVAILABILITY_CATALOG_ONLY_PROVIDER_ID } from '../registry'
import type { AvailabilityQuery } from '../types'

function makeQuery(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    items: [{ catalogProductId: 'product-1', catalogVariantId: 'variant-1', quantity: 1 }],
    ...overrides,
  }
}

describe('catalog-only fallback provider', () => {
  beforeEach(() => {
    setCatalogOnlyPolicyLookup(null)
  })

  afterAll(() => {
    setCatalogOnlyPolicyLookup(null)
  })

  it('is always registered under the catalog-only id', () => {
    expect(availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)).not.toBeNull()
  })

  it('returns not_tracked with canFulfil true and isAuthoritative true for every item with no policy hook (R5)', async () => {
    const provider = availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)!
    const result = await provider.getAvailability(makeQuery())
    const item = result.byItem['product-1:variant-1']
    expect(item.state).toBe('not_tracked')
    expect(item.canFulfil).toBe(true)
    expect(item.isAuthoritative).toBe(true)
    expect(item.availableQuantity).toBeNull()
    // not_tracked must never collapse into in_stock for a naive consumer.
    expect(item.state).not.toBe('in_stock')
  })

  it('reflects a future preorderReleaseAt from the policy hook as preorder', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    setCatalogOnlyPolicyLookup(async () => ({
      'product-1:variant-1': { preorderReleaseAt: future, policySourceId: 'policy-1' },
    }))
    const provider = availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)!
    const result = await provider.getAvailability(makeQuery())
    const item = result.byItem['product-1:variant-1']
    expect(item.state).toBe('preorder')
    expect(item.releaseAt).toBe(future)
    expect(item.policySourceId).toBe('policy-1')
  })

  it('treats a past preorderReleaseAt as no longer preorder', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    setCatalogOnlyPolicyLookup(async () => ({
      'product-1:variant-1': { preorderReleaseAt: past, policySourceId: 'policy-1' },
    }))
    const provider = availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)!
    const result = await provider.getAvailability(makeQuery())
    expect(result.byItem['product-1:variant-1'].state).not.toBe('preorder')
  })

  it('treats an inactive policy row as out_of_stock', async () => {
    setCatalogOnlyPolicyLookup(async () => ({
      'product-1:variant-1': { isActive: false, policySourceId: 'policy-2' },
    }))
    const provider = availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)!
    const result = await provider.getAvailability(makeQuery())
    const item = result.byItem['product-1:variant-1']
    expect(item.state).toBe('out_of_stock')
    expect(item.canFulfil).toBe(false)
  })

  it('treats is_stock_managed true (no real data source) as out_of_stock rather than in_stock', async () => {
    setCatalogOnlyPolicyLookup(async () => ({
      'product-1:variant-1': { isStockManaged: true, policySourceId: 'policy-3' },
    }))
    const provider = availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)!
    const result = await provider.getAvailability(makeQuery())
    const item = result.byItem['product-1:variant-1']
    expect(item.state).toBe('out_of_stock')
    expect(item.canFulfil).toBe(false)
  })

  it('degrades to the pure fallback when the policy hook throws', async () => {
    setCatalogOnlyPolicyLookup(async () => {
      throw new Error('boom')
    })
    const provider = availabilityProviderRegistry.get(AVAILABILITY_CATALOG_ONLY_PROVIDER_ID)!
    const result = await provider.getAvailability(makeQuery())
    expect(result.byItem['product-1:variant-1'].state).toBe('not_tracked')
  })

  it('is reachable end-to-end via resolveAvailability', async () => {
    const result = await resolveAvailability(makeQuery())
    expect(result.byItem['product-1:variant-1'].state).toBe('not_tracked')
  })
})
