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

import { compareVersions, actionsUpToVersion, findUpgradeAction, upgradeActions } from '../upgrade-actions'

describe('compareVersions', () => {
  describe('basic comparisons', () => {
    it('returns 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersions('0.3.4', '0.3.4')).toBe(0)
    })

    it('returns negative when first version is less than second', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0)
      expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    })

    it('returns positive when first version is greater than second', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0)
      expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0)
      expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    })
  })

  describe('edge cases - partial versions', () => {
    it('handles versions with fewer than 3 parts via semver coercion', () => {
      expect(compareVersions('1.2', '1.2.0')).toBe(0)
      expect(compareVersions('1', '1.0.0')).toBe(0)
      expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0)
    })
  })

  describe('edge cases - versions with extra parts', () => {
    it('handles versions with more than 3 parts by coercing to first 3', () => {
      expect(compareVersions('1.2.3.4', '1.2.3')).toBe(0)
      expect(compareVersions('1.2.3.4.5', '1.2.3')).toBe(0)
    })
  })

  describe('edge cases - prerelease versions', () => {
    it('coerces prerelease versions to numeric form', () => {
      expect(compareVersions('1.2.3-alpha', '1.2.3')).toBe(0)
      expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0)
    })
  })

  describe('edge cases - invalid versions', () => {
    it('throws an error for completely invalid version strings', () => {
      expect(() => compareVersions('invalid', '1.0.0')).toThrow(/Invalid version string/)
      expect(() => compareVersions('1.0.0', 'invalid')).toThrow(/Invalid version string/)
    })

    it('throws an error for empty strings', () => {
      expect(() => compareVersions('', '1.0.0')).toThrow(/Invalid version string/)
      expect(() => compareVersions('1.0.0', '')).toThrow(/Invalid version string/)
    })
  })

  describe('boundary cases', () => {
    it('handles version 0.0.0', () => {
      expect(compareVersions('0.0.0', '0.0.1')).toBeLessThan(0)
      expect(compareVersions('0.0.1', '0.0.0')).toBeGreaterThan(0)
    })

    it('handles large version numbers', () => {
      expect(compareVersions('100.200.300', '100.200.299')).toBeGreaterThan(0)
      expect(compareVersions('999.999.999', '1000.0.0')).toBeLessThan(0)
    })
  })
})

describe('actionsUpToVersion', () => {
  it('returns actions up to and including the specified version', () => {
    const actions = actionsUpToVersion('0.3.4')
    actions.forEach((action) => {
      expect(compareVersions(action.version, '0.3.4')).toBeLessThanOrEqual(0)
    })
  })

  it('returns empty array for versions before any action', () => {
    const actions = actionsUpToVersion('0.0.1')
    expect(actions).toEqual([])
  })

  it('returns actions sorted by version then by id', () => {
    const actions = actionsUpToVersion('99.99.99')
    for (let i = 1; i < actions.length; i++) {
      const prevVersion = actions[i - 1].version
      const currentVersion = actions[i].version
      const versionComparison = compareVersions(prevVersion, currentVersion)
      if (versionComparison === 0) {
        expect(actions[i - 1].id.localeCompare(actions[i].id)).toBeLessThanOrEqual(0)
      } else {
        expect(versionComparison).toBeLessThan(0)
      }
    }
  })
})

describe('findUpgradeAction', () => {
  it('finds an action by id within the version range', () => {
    const existingAction = upgradeActions[0]
    if (existingAction) {
      const found = findUpgradeAction(existingAction.id, existingAction.version)
      expect(found).toBeDefined()
      expect(found?.id).toBe(existingAction.id)
    }
  })

  it('returns undefined for non-existent action id', () => {
    const found = findUpgradeAction('non.existent.action', '99.99.99')
    expect(found).toBeUndefined()
  })

  it('returns undefined when action version exceeds max version', () => {
    const existingAction = upgradeActions[0]
    if (existingAction) {
      const found = findUpgradeAction(existingAction.id, '0.0.1')
      expect(found).toBeUndefined()
    }
  })
})

describe('interaction-statuses seed upgrade action', () => {
  it('registers the customers interaction-status seed action', () => {
    const action = upgradeActions.find((candidate) => candidate.id === 'customers.seed-interaction-statuses')
    expect(action).toBeDefined()
    expect(action?.version).toBe('0.6.5')
    expect(action?.messageKey).toBe('customers.config.upgradeActions.interactionStatuses.message')
    expect(typeof action?.run).toBe('function')
  })
})

describe('payment-session initialization prune upgrade action', () => {
  it('registers the retention schedule for an existing tenant organization', async () => {
    const action = upgradeActions.find(
      (candidate) => candidate.id === 'payment_gateways.register-session-initialization-prune',
    )
    const register = jest.fn().mockResolvedValue(undefined)
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: jest.fn(() => ({ register })),
    }

    expect(action?.version).toBe('0.6.6')
    await action?.run({
      container: container as never,
      em: {} as never,
      tenantId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
    })

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '10000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000001',
      targetQueue: 'payment-gateway-session-initialization-prune',
    }))
  })
})

// #8822: existing tenants that upgraded to this release got none of these three
// schedules, unlike the sibling cart/promotions/availability schedules shipped the same
// release — each of those already had an upgrade action, these three did not.
describe('#8822 schedule upgrade actions for existing tenants', () => {
  it.each([
    ['customer_groups.register-schedules', 'customer_groups.credit_exposure_audit'],
    ['customer_groups.register-schedules', 'customer_groups.expire_approvals'],
  ] as Array<[string, string]>)('%s registers %s', async (actionId, expectedQueue) => {
    const action = upgradeActions.find((candidate) => candidate.id === actionId)
    const register = jest.fn().mockResolvedValue(undefined)
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: jest.fn(() => ({ register })),
    }

    expect(action).toBeDefined()
    expect(action?.version).toBe('0.10.0')
    await action?.run({
      container: container as never,
      em: {} as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ targetQueue: expectedQueue }))
  })

  it.each([
    ['assisted_selling.register-schedules', 'assisted_selling.idle_close'],
    ['assisted_selling.register-schedules', 'assisted_selling.retention'],
  ] as Array<[string, string]>)('%s registers %s', async (actionId, expectedQueue) => {
    const action = upgradeActions.find((candidate) => candidate.id === actionId)
    const register = jest.fn().mockResolvedValue(undefined)
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: jest.fn(() => ({ register })),
    }

    expect(action).toBeDefined()
    expect(action?.version).toBe('0.10.0')
    await action?.run({
      container: container as never,
      em: {} as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ targetQueue: expectedQueue }))
  })

  it("checkout.register-schedules resolves the checkout package's own DI registration instead of importing it", async () => {
    const action = upgradeActions.find((candidate) => candidate.id === 'checkout.register-schedules')
    const ensureTransactionExpirySchedule = jest.fn().mockResolvedValue(undefined)
    const container = {
      hasRegistration: (name: string) => name === 'checkoutScheduleUpgradeRegistrar',
      resolve: jest.fn(() => ensureTransactionExpirySchedule),
    }

    expect(action).toBeDefined()
    expect(action?.version).toBe('0.10.0')
    await action?.run({
      container: container as never,
      em: {} as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(container.resolve).toHaveBeenCalledWith('checkoutScheduleUpgradeRegistrar')
    expect(ensureTransactionExpirySchedule).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
    )
  })

  it('checkout.register-schedules is a no-op when checkout is not installed', async () => {
    const action = upgradeActions.find((candidate) => candidate.id === 'checkout.register-schedules')
    const container = {
      hasRegistration: () => false,
      resolve: jest.fn(),
    }

    await action?.run({
      container: container as never,
      em: {} as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(container.resolve).not.toHaveBeenCalled()
  })
})

describe('encryption-map upgrade action cache order', () => {
  it.each([
    ['devices.seed-push-token-encryption-map', ['devices:user_device']],
    [
      'phone_calls.seed-call-encryption-maps',
      ['phone_calls:phone_call', 'phone_calls:phone_call_participant'],
    ],
  ] as Array<[string, string[]]>)('defers %s cache invalidation until the caller confirms commit', async (actionId, entityIds) => {
    const action = upgradeActions.find((candidate) => candidate.id === actionId)
    const execute = jest.fn(async () => [{ id: 'map-id', updated_at: new Date() }])
    const invalidateMap = jest.fn(async () => undefined)
    const callbacks: Array<() => void | Promise<void>> = []
    const container = {
      resolve: jest.fn(() => ({ invalidateMap })),
    }

    await action?.run({
      container: container as never,
      em: { execute } as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deferAfterCommit: (callback) => callbacks.push(callback),
    })

    expect(execute).toHaveBeenCalledTimes(entityIds.length)
    expect(invalidateMap).not.toHaveBeenCalled()
    expect(callbacks).toHaveLength(1)

    await callbacks[0]?.()

    expect(invalidateMap.mock.calls).toEqual(
      entityIds.map((entityId) => [entityId, 'tenant-1', 'org-1']),
    )
  })
})
