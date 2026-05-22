import type { Module } from '../../modules/registry'
import { getModules } from '../../lib/modules/registry'
import {
  filterGrantsByEnabledModules,
  getEnabledModuleIds,
  getOwningModuleId,
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
})
