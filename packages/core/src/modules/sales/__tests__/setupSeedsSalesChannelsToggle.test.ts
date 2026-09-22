/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'

type SeedCalls = {
  seedSalesStatusDictionaries: jest.Mock
  seedSalesAdjustmentKinds: jest.Mock
  ensureExampleShippingMethods: jest.Mock
  ensureExamplePaymentMethods: jest.Mock
  seedSalesChannelsToggle: jest.Mock
  seedSalesExamples: jest.Mock
}

function createEm(calls: string[]): EntityManager {
  const em = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    persist: jest.fn(),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    flush: jest.fn().mockResolvedValue(undefined),
    transactional: jest.fn(async (cb: (tem: unknown) => Promise<void>) => {
      calls.push('tax-rates')
      await cb(em)
    }),
  }
  return em as unknown as EntityManager
}

function mockSetupOnlyModules(evaluations: string[], calls: string[]): SeedCalls {
  const seedSalesStatusDictionaries = jest.fn(async () => {
    calls.push('status-dictionaries')
  })
  const seedSalesAdjustmentKinds = jest.fn(async () => {
    calls.push('adjustment-kinds')
  })
  const ensureExampleShippingMethods = jest.fn(async () => {
    calls.push('shipping-methods')
  })
  const ensureExamplePaymentMethods = jest.fn(async () => {
    calls.push('payment-methods')
  })
  const seedSalesChannelsToggle = jest.fn(async () => {
    calls.push('channels-toggle')
  })
  const seedSalesExamples = jest.fn(async () => {
    calls.push('examples')
  })

  jest.doMock('../lib/dictionaries', () => {
    evaluations.push('dictionaries')
    return { seedSalesStatusDictionaries, seedSalesAdjustmentKinds }
  })
  jest.doMock('../seed/examples-data', () => {
    evaluations.push('examples-data')
    return { ensureExampleShippingMethods, ensureExamplePaymentMethods }
  })
  jest.doMock('../lib/salesChannelsToggleSeed', () => {
    evaluations.push('sales-channels-toggle')
    return { seedSalesChannelsToggle }
  })
  jest.doMock('../seed/examples', () => {
    evaluations.push('examples')
    return { seedSalesExamples }
  })

  return {
    seedSalesStatusDictionaries,
    seedSalesAdjustmentKinds,
    ensureExampleShippingMethods,
    ensureExamplePaymentMethods,
    seedSalesChannelsToggle,
    seedSalesExamples,
  }
}

describe('sales setup seeds', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('defers default seed implementations until seedDefaults and preserves their behavior and order', async () => {
    const evaluations: string[] = []
    const calls: string[] = []
    const seeds = mockSetupOnlyModules(evaluations, calls)

    const setupModule = await import('../setup')

    expect(evaluations).toEqual([])

    const em = createEm(calls)
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    await setupModule.default.seedDefaults?.({ em, ...scope, container: {} as never })

    expect(evaluations).toEqual(['dictionaries', 'examples-data', 'sales-channels-toggle'])
    expect(calls).toEqual([
      'tax-rates',
      'status-dictionaries',
      'adjustment-kinds',
      'shipping-methods',
      'payment-methods',
      'channels-toggle',
    ])
    expect(seeds.seedSalesExamples).not.toHaveBeenCalled()
  })

  it('propagates a default seed failure without running later seed responsibilities', async () => {
    const evaluations: string[] = []
    const calls: string[] = []
    const seeds = mockSetupOnlyModules(evaluations, calls)
    const failure = new Error('dictionary seed failed')
    seeds.seedSalesStatusDictionaries.mockImplementationOnce(async () => {
      calls.push('status-dictionaries')
      throw failure
    })
    const setupModule = await import('../setup')
    const em = createEm(calls)

    await expect(
      setupModule.default.seedDefaults?.({
        em,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        container: {} as never,
      }),
    ).rejects.toBe(failure)

    expect(calls).toEqual(['tax-rates', 'status-dictionaries'])
    expect(seeds.seedSalesAdjustmentKinds).not.toHaveBeenCalled()
    expect(seeds.ensureExampleShippingMethods).not.toHaveBeenCalled()
    expect(seeds.seedSalesChannelsToggle).not.toHaveBeenCalled()
  })

  it('defers example seed implementation until seedExamples', async () => {
    const evaluations: string[] = []
    const calls: string[] = []
    const seeds = mockSetupOnlyModules(evaluations, calls)

    const setupModule = await import('../setup')

    expect(evaluations).toEqual([])

    const em = createEm(calls)
    const container = { resolve: jest.fn() } as never
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    await setupModule.default.seedExamples?.({ em, container, ...scope })

    expect(evaluations).toEqual(['examples'])
    expect(calls).toEqual(['examples'])
    expect(seeds.seedSalesStatusDictionaries).not.toHaveBeenCalled()
    expect(seeds.ensureExampleShippingMethods).not.toHaveBeenCalled()
    expect(seeds.seedSalesChannelsToggle).not.toHaveBeenCalled()
  })
})
