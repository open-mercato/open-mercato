import type { AvailabilityQuery } from '@open-mercato/shared/lib/availability'
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
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`not registered: ${name}`)
      },
      register: jest.fn(),
    }

    register(container as any)

    const mockedSet = setCatalogOnlyPolicyLookup as jest.Mock
    expect(mockedSet).toHaveBeenCalledTimes(1)
    const lookup = mockedSet.mock.calls[0][0] as (query: AvailabilityQuery) => Promise<Record<string, unknown>>

    const query: AvailabilityQuery = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      items: Array.from({ length: 50 }, (_, i) => ({ catalogProductId: `p${i}`, catalogVariantId: `v${i}`, quantity: 1 })),
    }
    const overrides = await lookup(query)

    expect(Object.keys(overrides)).toHaveLength(50)
    // One batched AvailabilityPolicy query for the whole item set, regardless of count.
    expect(find).toHaveBeenCalledTimes(1)
  })
})
