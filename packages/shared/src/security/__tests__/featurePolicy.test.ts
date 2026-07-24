import type { Module } from '../../modules/registry'
import { getModules } from '../../lib/modules/registry'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '../../modules/overrides'
import {
  authorizeFeatures,
  getRemovedAclFeatureIds,
  isAclFeatureRemoved,
  resolveEffectiveFeatures,
} from '../featurePolicy'

jest.mock('../../lib/modules/registry', () => ({
  getModules: jest.fn(),
}))

const mockGetModules = jest.mocked(getModules)

const modules: Module[] = [
  {
    id: 'auth',
    features: [
      { id: 'auth.users.view', title: 'View users', module: 'auth' },
      { id: 'auth.users.manage', title: 'Manage users', module: 'auth' },
    ],
  },
  {
    id: 'dashboards',
    features: [
      { id: 'analytics.view', title: 'View analytics', module: 'dashboards' },
    ],
  },
  {
    id: 'customer_accounts',
    setup: {
      defaultCustomerRoleFeatures: {
        portal_admin: ['portal.*'],
        buyer: ['portal.orders.view', 'portal.account.manage'],
      },
    },
    frontendRoutes: [
      {
        Component: () => null,
        requireCustomerFeatures: ['portal.quotes.view'],
      },
    ],
  },
]

describe('featurePolicy', () => {
  beforeEach(() => {
    mockGetModules.mockReturnValue(modules)
    resetModuleContractOverridesForTests()
  })

  afterEach(() => {
    resetModuleContractOverridesForTests()
    jest.resetAllMocks()
  })

  it('reports exact removals and lets a later replacement restore the feature', () => {
    applyAclFeatureOverrides({
      'auth.users.manage': null,
      'legacy.feature': null,
    })

    expect(getRemovedAclFeatureIds()).toEqual(['auth.users.manage', 'legacy.feature'])
    expect(isAclFeatureRemoved('auth.users.manage')).toBe(true)

    applyAclFeatureOverrides({
      'auth.users.manage': {
        id: 'auth.users.manage',
        title: 'Manage users',
        module: 'auth',
      },
    })

    expect(isAclFeatureRemoved('auth.users.manage')).toBe(false)
    expect(getRemovedAclFeatureIds()).toEqual(['legacy.feature'])
  })

  it.each([
    { grantedFeatures: ['auth.users.manage'], unrestricted: false, siblingAllowed: false },
    { grantedFeatures: ['auth.*'], unrestricted: false, siblingAllowed: true },
    { grantedFeatures: ['*'], unrestricted: false, siblingAllowed: true },
    { grantedFeatures: [], unrestricted: true, siblingAllowed: true },
  ])('denies a removed requirement before grants or unrestricted access', ({
    siblingAllowed,
    ...subject
  }) => {
    applyAclFeatureOverrides({ 'auth.users.manage': null })

    expect(authorizeFeatures(['auth.users.manage'], subject)).toBe(false)
    expect(authorizeFeatures(['auth.users.view'], subject)).toBe(siblingAllowed)
  })

  it('enforces invalid scope before unrestricted access', () => {
    expect(authorizeFeatures(['auth.users.view'], {
      grantedFeatures: ['*'],
      unrestricted: true,
      scopeAllowed: false,
    })).toBe(false)
  })

  it('denies requirements owned by disabled modules', () => {
    expect(authorizeFeatures(['search.global'], {
      grantedFeatures: ['*'],
      unrestricted: true,
    })).toBe(false)
  })

  it('expands wildcards into a deterministic concrete set including portal sources', () => {
    expect(resolveEffectiveFeatures(['*'])).toEqual([
      'auth.users.view',
      'auth.users.manage',
      'analytics.view',
      'portal.orders.view',
      'portal.account.manage',
      'portal.quotes.view',
    ])
    expect(resolveEffectiveFeatures(['portal.*'])).toEqual([
      'portal.orders.view',
      'portal.account.manage',
      'portal.quotes.view',
    ])
  })

  it('removes nulled features while preserving siblings and explicit custom grants', () => {
    applyAclFeatureOverrides({
      'auth.users.manage': null,
      'auth.custom.audit': null,
    })

    expect(resolveEffectiveFeatures([
      'auth.*',
      'auth.custom.export',
      'auth.custom.audit',
    ])).toEqual([
      'auth.users.view',
      'auth.custom.export',
    ])
  })

  it('uses declared ownership for off-convention features', () => {
    expect(resolveEffectiveFeatures(['analytics.*'])).toEqual(['analytics.view'])
    expect(authorizeFeatures(['analytics.view'], {
      grantedFeatures: ['analytics.*'],
    })).toBe(true)
  })

  it('fails closed for wildcards when the module registry is unavailable', () => {
    mockGetModules.mockImplementation(() => {
      throw new Error('registry unavailable')
    })
    applyAclFeatureOverrides({ 'legacy.removed': null })

    expect(resolveEffectiveFeatures([
      '*',
      'legacy.*',
      'legacy.explicit',
      'legacy.removed',
      'legacy.explicit',
    ])).toEqual(['legacy.explicit'])
  })
})
