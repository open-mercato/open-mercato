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
