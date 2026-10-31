import type { AvailabilityQuery, CatalogOnlyPolicyLookup } from '@open-mercato/shared/lib/availability'
import { setCatalogOnlyPolicyLookup } from '@open-mercato/shared/lib/availability'
import { register } from '../di'
import { AvailabilityPolicy } from '../data/entities'

jest.mock('@open-mercato/shared/lib/availability', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/availability'),
  setCatalogOnlyPolicyLookup: jest.fn(),
}))

describe('availability di.ts — catalog-only policy lookup hook', () => {
  it('resolves a multi-item batch with exactly one AvailabilityPolicy query (R4), never one per item', async () => {
    const find = jest.fn().mockImplementation(async (entityClass: unknown) => (entityClass === AvailabilityPolicy ? [] : []))
    const em = { find, fork: () => em }
    const container = {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return em as unknown as T
        throw new Error(`not registered: ${name}`)
      },
      register: jest.fn(),
    }

    register(container as unknown as Parameters<typeof register>[0])

    const mockedSet = setCatalogOnlyPolicyLookup as jest.Mock
    expect(mockedSet).toHaveBeenCalledTimes(1)
    const lookup = mockedSet.mock.calls[0][0] as CatalogOnlyPolicyLookup

    const query: AvailabilityQuery = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      items: Array.from({ length: 50 }, (_, i) => ({ catalogProductId: `p${i}`, catalogVariantId: `v${i}`, quantity: 1 })),
    }
    const overrides = await lookup(query, { container })

    expect(Object.keys(overrides)).toHaveLength(50)
    // One batched AvailabilityPolicy query for the whole item set, regardless of count.
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('passes the resolved order-quantity rules to the catalog-only fallback', async () => {
    const policyRow = {
      id: 'policy-1',
      productId: 'p1',
      variantId: null,
      storeId: null,
      isStockManaged: false,
      allowBackorder: false,
      hideWhenOutOfStock: false,
      isActive: true,
      backorderLeadTimeDays: null,
      preorderReleaseAt: null,
      lowStockThreshold: null,
      minOrderQuantity: 2,
      maxOrderQuantity: 10,
      quantityIncrement: 2,
    }
    const find = jest.fn().mockResolvedValue([policyRow])
    const em = { find, fork: () => em }
    const container = {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return em as unknown as T
        throw new Error(`not registered: ${name}`)
      },
      register: jest.fn(),
    }

    register(container as unknown as Parameters<typeof register>[0])

    const mockedSet = setCatalogOnlyPolicyLookup as jest.Mock
    const lookup = mockedSet.mock.calls[mockedSet.mock.calls.length - 1][0] as CatalogOnlyPolicyLookup
    const overrides = await lookup(
      {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        items: [{ catalogProductId: 'p1', catalogVariantId: null, quantity: 3 }],
      },
      { container },
    )

    expect(overrides['p1:']).toEqual(
      expect.objectContaining({ minOrderQuantity: 2, maxOrderQuantity: 10, quantityIncrement: 2 }),
    )
  })

  it('resolves from the per-call container, never from the container that registered the hook', async () => {
    function makeContainer() {
      const find = jest.fn().mockResolvedValue([])
      const em = { find, fork: () => em }
      const container = {
        resolve: <T,>(name: string): T => {
          if (name === 'em') return em as unknown as T
          throw new Error(`not registered: ${name}`)
        },
        register: jest.fn(),
      }
      return { container, find }
    }
    const mockedSet = setCatalogOnlyPolicyLookup as jest.Mock
    const first = makeContainer()
    const second = makeContainer()
    register(first.container as unknown as Parameters<typeof register>[0])
    const firstLookup = mockedSet.mock.calls[mockedSet.mock.calls.length - 1][0] as CatalogOnlyPolicyLookup
    register(second.container as unknown as Parameters<typeof register>[0])
    const secondLookup = mockedSet.mock.calls[mockedSet.mock.calls.length - 1][0] as CatalogOnlyPolicyLookup

    expect(secondLookup).toBe(firstLookup)

    const query: AvailabilityQuery = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      items: [{ catalogProductId: 'p1', catalogVariantId: null, quantity: 1 }],
    }
    await secondLookup(query, { container: first.container })
    expect(first.find).toHaveBeenCalledTimes(1)
    expect(second.find).not.toHaveBeenCalled()

    await secondLookup(query, { container: second.container })
    expect(second.find).toHaveBeenCalledTimes(1)
    expect(first.find).toHaveBeenCalledTimes(1)
  })
})
