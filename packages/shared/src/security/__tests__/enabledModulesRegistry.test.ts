import type { Module } from '../../modules/registry'
import { getModules } from '../../lib/modules/registry'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '../../modules/overrides'
import {
  filterGrantsByEnabledModules,
  getEnabledModuleIds,
  getOwningModuleId,
  getRemovedAclFeatureIds,
  isAclFeatureRemoved,
} from '../enabledModulesRegistry'

jest.mock('../../lib/modules/registry', () => ({
  getModules: jest.fn(),
}))

const mockGetModules = jest.mocked(getModules)

describe('enabledModulesRegistry', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('derives the owning module from the feature id prefix when the registry has no declarations', () => {
    mockGetModules.mockReturnValue([{ id: 'auth' } as Module])
    expect(getOwningModuleId('ai_assistant.view')).toBe('ai_assistant')
    expect(getOwningModuleId('plain-feature')).toBe('plain-feature')
  })

  it('uses the declared module from the registry for off-convention feature ids (e.g. analytics.view)', () => {
    mockGetModules.mockReturnValue([
      {
        id: 'dashboards',
        features: [
          { id: 'dashboards.view', title: 'View dashboard', module: 'dashboards' },
          { id: 'analytics.view', title: 'View analytics widgets', module: 'dashboards' },
        ],
      } as Module,
      { id: 'auth' } as Module,
    ])

    expect(getOwningModuleId('analytics.view')).toBe('dashboards')
    expect(getOwningModuleId('dashboards.view')).toBe('dashboards')
  })

  it('reads enabled module ids from the registered module list', () => {
    mockGetModules.mockReturnValue([
      { id: 'auth' } as Module,
      { id: 'customer_accounts' } as Module,
    ])

    expect(getEnabledModuleIds()).toEqual(['auth', 'customer_accounts'])
  })

  it('drops grants whose backing module is disabled', () => {
    mockGetModules.mockReturnValue([
      { id: 'auth' } as Module,
      { id: 'customer_accounts' } as Module,
    ])

    expect(
      filterGrantsByEnabledModules([
        'auth.*',
        'search.global',
        'customer_accounts.view',
      ]),
    ).toEqual(['auth.*', 'customer_accounts.view'])
  })

  it('keeps an off-convention grant when its declared owning module is enabled', () => {
    mockGetModules.mockReturnValue([
      {
        id: 'dashboards',
        features: [
          { id: 'analytics.view', title: 'View analytics widgets', module: 'dashboards' },
        ],
      } as Module,
      { id: 'auth' } as Module,
    ])

    expect(
      filterGrantsByEnabledModules(['analytics.view', 'auth.users.view', 'unknown.feature']),
    ).toEqual(['analytics.view', 'auth.users.view'])
  })

  it('drops an off-convention grant when its declared owning module is disabled', () => {
    mockGetModules.mockReturnValue([{ id: 'auth' } as Module])

    expect(filterGrantsByEnabledModules(['analytics.view'])).toEqual([])
  })

  it('expands the superadmin wildcard into enabled-module wildcards', () => {
    mockGetModules.mockReturnValue([
      { id: 'auth' } as Module,
      { id: 'customer_accounts' } as Module,
    ])

    expect(filterGrantsByEnabledModules(['*'])).toEqual(['auth.*', 'customer_accounts.*'])
  })

  it('also expands the superadmin wildcard to off-convention prefixes whose owning module is enabled', () => {
    mockGetModules.mockReturnValue([
      {
        id: 'dashboards',
        features: [
          { id: 'dashboards.view', title: 'View dashboard', module: 'dashboards' },
          { id: 'analytics.view', title: 'View analytics widgets', module: 'dashboards' },
        ],
      } as Module,
      { id: 'auth' } as Module,
    ])

    expect(filterGrantsByEnabledModules(['*'])).toEqual([
      'dashboards.*',
      'auth.*',
      'analytics.*',
    ])
  })

  it('falls back to the raw grant list when the module registry is unavailable', () => {
    mockGetModules.mockImplementation(() => {
      throw new Error('registry not initialized')
    })

    expect(filterGrantsByEnabledModules(['*', 'search.global'])).toEqual(['*', 'search.global'])
  })

  describe('removed ACL features (null overrides)', () => {
    afterEach(() => {
      resetModuleContractOverridesForTests()
    })

    it('reports feature ids overridden to null as removed', () => {
      applyAclFeatureOverrides({ 'sales.documents.number.edit': null })

      expect(isAclFeatureRemoved('sales.documents.number.edit')).toBe(true)
      expect(isAclFeatureRemoved('sales.documents.view')).toBe(false)
      expect(getRemovedAclFeatureIds()).toEqual(new Set(['sales.documents.number.edit']))
    })

    it('does not report a feature as removed when the override replaces it with a value', () => {
      applyAclFeatureOverrides({ 'sales.documents.number.edit': { id: 'sales.documents.number.edit' } })

      expect(isAclFeatureRemoved('sales.documents.number.edit')).toBe(false)
      expect(getRemovedAclFeatureIds().size).toBe(0)
    })

    it('drops explicit grants for removed features while keeping module wildcards', () => {
      mockGetModules.mockReturnValue([
        {
          id: 'sales',
          features: [{ id: 'sales.documents.view', title: 'View documents' }],
        } as Module,
      ])
      applyAclFeatureOverrides({ 'sales.documents.number.edit': null })

      expect(
        filterGrantsByEnabledModules(['sales.*', 'sales.documents.number.edit', 'sales.documents.view']),
      ).toEqual(['sales.*', 'sales.documents.view'])
    })

    it('drops explicit grants for removed features even when the module registry is unavailable', () => {
      mockGetModules.mockImplementation(() => {
        throw new Error('registry not initialized')
      })
      applyAclFeatureOverrides({ 'sales.documents.number.edit': null })

      expect(
        filterGrantsByEnabledModules(['sales.documents.number.edit', 'sales.documents.view']),
      ).toEqual(['sales.documents.view'])
    })
  })
})
