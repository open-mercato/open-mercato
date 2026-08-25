/** @jest-environment node */

jest.mock('../lib/dictionaries', () => ({
  seedSalesStatusDictionaries: jest.fn().mockResolvedValue(undefined),
  seedSalesAdjustmentKinds: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../seed/examples-data', () => ({
  ensureExampleShippingMethods: jest.fn().mockResolvedValue(undefined),
  ensureExamplePaymentMethods: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../seed/examples', () => ({
  seedSalesExamples: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../lib/salesChannelsToggleSeed', () => ({
  seedSalesChannelsToggle: jest.fn().mockResolvedValue(undefined),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { seedSalesChannelsToggle } from '../lib/salesChannelsToggleSeed'
import setup from '../setup'

const seedSalesChannelsToggleMock = jest.mocked(seedSalesChannelsToggle)

function createEm(): EntityManager {
  const em = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    persist: jest.fn(),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (cb: (tem: unknown) => Promise<void>) => cb(em)),
  }
  return em as unknown as EntityManager
}

describe('sales setup seedDefaults', () => {
  beforeEach(() => {
    seedSalesChannelsToggleMock.mockClear()
  })

  // Regression for #5503: the toggle used to live only in the core
  // feature_toggles defaults file, so any database seeded before it shipped
  // never registered it and every page mounting useSalesChannelsEnabled 404d.
  it('registers the sales channels feature toggle', async () => {
    const em = createEm()

    await setup.seedDefaults?.({ em, tenantId: 'tenant-1', organizationId: 'org-1', container: {} as never })

    expect(seedSalesChannelsToggleMock).toHaveBeenCalledTimes(1)
    expect(seedSalesChannelsToggleMock).toHaveBeenCalledWith(em)
  })
})
