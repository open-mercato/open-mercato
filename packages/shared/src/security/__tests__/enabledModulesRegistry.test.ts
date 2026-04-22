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

  it('derives the owning module from the feature id prefix', () => {
    expect(getOwningModuleId('ai_assistant.view')).toBe('ai_assistant')
    expect(getOwningModuleId('plain-feature')).toBe('plain-feature')
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

  it('expands the superadmin wildcard into enabled-module wildcards', () => {
    mockGetModules.mockReturnValue([
      { id: 'auth' } as Module,
      { id: 'customer_accounts' } as Module,
    ])

    expect(filterGrantsByEnabledModules(['*'])).toEqual(['auth.*', 'customer_accounts.*'])
  })

  it('falls back to the raw grant list when the module registry is unavailable', () => {
    mockGetModules.mockImplementation(() => {
      throw new Error('registry not initialized')
    })

    expect(filterGrantsByEnabledModules(['*', 'search.global'])).toEqual(['*', 'search.global'])
  })
})
