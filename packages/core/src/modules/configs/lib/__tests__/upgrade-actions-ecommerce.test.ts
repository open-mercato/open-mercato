jest.mock('@open-mercato/core/modules/catalog/lib/seeds', () => ({
  installExampleCatalogData: jest.fn(),
}))
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_, fn) => fn()),
}))
jest.mock('@open-mercato/shared/lib/crud/cache-stats', () => ({
  collectCrudCacheStats: jest.fn().mockResolvedValue({ segments: [] }),
  purgeCrudCacheSegment: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  isCrudCacheEnabled: jest.fn().mockReturnValue(false),
  resolveCrudCache: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/ecommerce/lib/seedDraftStore', () => ({
  seedDraftStore: jest.fn(async () => ({ status: 'created', storeId: 'store-1' })),
}))

import { seedDraftStore } from '@open-mercato/core/modules/ecommerce/lib/seedDraftStore'
import { actionsUpToVersion, findUpgradeAction, upgradeActions } from '../upgrade-actions'

const mockedSeed = seedDraftStore as jest.Mock

const ACTION_ID = 'ecommerce.seed-draft-store'

describe('ecommerce.seed-draft-store upgrade action', () => {
  beforeEach(() => mockedSeed.mockClear())

  it('is registered and gated on the ecommerce module', () => {
    const action = upgradeActions.find((entry) => entry.id === ACTION_ID)
    expect(action).toBeDefined()
    expect(action?.requiredModules).toEqual(['ecommerce'])
    expect(action?.messageKey).toBe('configs.upgrades.ecommerceDraftStore.message')
    expect(action?.ctaKey).toBe('configs.upgrades.ecommerceDraftStore.cta')
    expect(action?.successKey).toBe('configs.upgrades.ecommerceDraftStore.success')
    expect(action?.loadingKey).toBe('configs.upgrades.ecommerceDraftStore.loading')
  })

  it('is offered once the app reaches its version and not before', () => {
    const action = upgradeActions.find((entry) => entry.id === ACTION_ID)
    expect(action).toBeDefined()
    expect(findUpgradeAction(ACTION_ID, action!.version)).toBe(action)
    expect(actionsUpToVersion('0.8.0').some((entry) => entry.id === ACTION_ID)).toBe(false)
  })

  it('calls the shared seed with the tenant, the organization and the base currency resolver', async () => {
    const action = findUpgradeAction(ACTION_ID, '99.0.0')
    const em = {}
    const resolveBaseCurrency = jest.fn(async () => ({ status: 'resolved' as const, code: 'EUR' }))
    const container = { resolve: jest.fn(() => ({ resolveBaseCurrency })) }

    await action!.run({ tenantId: 'tenant-1', organizationId: 'org-1', container: container as never, em: em as never })

    expect(mockedSeed).toHaveBeenCalledTimes(1)
    const [passedEm, scope, options] = mockedSeed.mock.calls[0]
    expect(passedEm).toBe(em)
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
    await expect(options.resolveCurrencyCode()).resolves.toBe('EUR')
    expect(resolveBaseCurrency).toHaveBeenCalledWith({ tenantId: 'tenant-1', organizationIds: ['org-1'] })
  })

  it('falls back to no currency when the currencies module is not available', async () => {
    const action = findUpgradeAction(ACTION_ID, '99.0.0')
    const container = {
      resolve: jest.fn(() => {
        throw new Error('[internal] not registered')
      }),
    }

    await action!.run({ tenantId: 'tenant-1', organizationId: 'org-1', container: container as never, em: {} as never })

    const options = mockedSeed.mock.calls[0][2]
    await expect(options.resolveCurrencyCode()).resolves.toBeNull()
  })
})
