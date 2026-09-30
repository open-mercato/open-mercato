/** @jest-environment node */

// `CrudForm.hiddenGroupIds` can only be passed by the host that owns the form, so a downstream app had
// no documented way to hide a built-in card on a page it does not own. `overrides.forms.sections` wires
// that as a real override domain, which `BACKWARD_COMPATIBILITY.md` §3 explicitly reserves for additive
// wiring. The domain transports a data-only policy; what a host does with it is that host's contract.

const mockLoggerWarn = jest.fn()

jest.mock('../../lib/logger', () => ({
  createLogger: () => {
    const child = { warn: (...args: unknown[]) => mockLoggerWarn(...args), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    return { child: () => child, warn: child.warn, error: child.error, info: child.info, debug: child.debug }
  },
}))

import {
  applyFormSectionPolicyOverrides,
  applyModuleOverridesFromEnabledModules,
  getFormSectionPolicy,
  resetModuleContractOverridesForTests,
  resetModuleOverrideAppliersForTests,
  subscribeToFormSectionPolicies,
} from '../overrides'

const HOST = 'crud-form:catalog.product'

function reset() {
  resetModuleOverrideAppliersForTests()
  resetModuleContractOverridesForTests()
  mockLoggerWarn.mockClear()
}

beforeEach(reset)
afterEach(reset)

const collisionWarnings = () =>
  mockLoggerWarn.mock.calls.filter((call) => String(call[0]).includes('declared by more than one module'))

describe('forms.sections override domain', () => {
  it('is unset when no module declares it', () => {
    applyModuleOverridesFromEnabledModules([{ id: 'catalog' }, { id: 'sales', overrides: {} }])

    expect(getFormSectionPolicy(HOST)).toBeNull()
  })

  it('captures the policy a module declares — proving the domain is wired', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance', 'product-uom'] } } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['compliance', 'product-uom'] })
    // An unwired domain would be dropped with a "not yet wired" warning instead of being captured.
    expect(mockLoggerWarn.mock.calls.filter((call) => String(call[0]).includes('not yet wired'))).toEqual([])
  })

  it('keeps hosts independent', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: {
          forms: {
            sections: {
              [HOST]: { hidden: ['compliance'] },
              'crud-form:customers.company': { hidden: ['profile'] },
            },
          },
        },
      },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['compliance'] })
    expect(getFormSectionPolicy('crud-form:customers.company')).toEqual({ hidden: ['profile'] })
    expect(getFormSectionPolicy('crud-form:sales.order')).toBeNull()
  })

  it('drops blank entries and de-duplicates while preserving first position', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { forms: { sections: { [HOST]: { hidden: ['  compliance  ', '', '   ', 'compliance', 'dimensions'] } } } },
      },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['compliance', 'dimensions'] })
  })

  it('records an empty hidden list as a real policy, not as "no policy"', () => {
    // An explicit `hidden: []` means "hide nothing", which is observably the same as the shipped form
    // but is still a declaration — a host may legitimately want to distinguish it from an absent key.
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: [] } } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: [] })
  })

  it('ignores a non-array hidden value rather than throwing', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: 'compliance' as never } } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toBeNull()
  })

  it('treats null as "disable the policy", leaving the host on its shipped behaviour', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'first', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
      { id: 'second', overrides: { forms: { sections: { [HOST]: null } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toBeNull()
  })

  it('lets a later module resurrect a policy a previous one disabled', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'first', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
      { id: 'second', overrides: { forms: { sections: { [HOST]: null } } } },
      { id: 'third', overrides: { forms: { sections: { [HOST]: { hidden: ['variants'] } } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['variants'] })
  })

  it('lets the later module win when two declare a policy for one host, and says so', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'first', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
      { id: 'second', overrides: { forms: { sections: { [HOST]: { hidden: ['dimensions'] } } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['dimensions'] })
    expect(collisionWarnings()).toHaveLength(1)
  })

  it('does not warn when the same module declares it twice', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['dimensions'] } } } } },
    ])

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['dimensions'] })
    expect(collisionWarnings()).toEqual([])
  })

  it('ignores a blank host key', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { '   ': { hidden: ['compliance'] } } } } },
    ])

    expect(getFormSectionPolicy('   ')).toBeNull()
  })

  it('returns null for a non-string or empty host id', () => {
    expect(getFormSectionPolicy('')).toBeNull()
    expect(getFormSectionPolicy(undefined as never)).toBeNull()
  })

  it('is cleared by the store reset hook so suites cannot leak into each other', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
    ])
    expect(getFormSectionPolicy(HOST)).not.toBeNull()

    resetModuleContractOverridesForTests()

    expect(getFormSectionPolicy(HOST)).toBeNull()
  })
})

describe('forms.sections programmatic tier', () => {
  it('takes precedence over the modules.ts declaration', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['from-modules'] } } } } },
    ])
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['from-code'] } })

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['from-code'] })
  })

  it('falls back to the modules.ts declaration when cleared with null', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['from-modules'] } } } } },
    ])
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['from-code'] } })
    applyFormSectionPolicyOverrides(null)

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['from-modules'] })
  })

  it('applies the same normalisation as the modules.ts tier', () => {
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['  compliance  ', '', 'compliance', 'meta'] } })

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['compliance', 'meta'] })
  })

  it('works before any module override has been dispatched', () => {
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['variants'] } })

    expect(getFormSectionPolicy(HOST)).toEqual({ hidden: ['variants'] })
  })

  it('replaces the whole programmatic map on each call rather than merging', () => {
    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })
    applyFormSectionPolicyOverrides({ 'crud-form:customers.company': { hidden: ['profile'] } })

    expect(getFormSectionPolicy(HOST)).toBeNull()
    expect(getFormSectionPolicy('crud-form:customers.company')).toEqual({ hidden: ['profile'] })
  })
})

describe('forms.sections change notification', () => {
  it('notifies subscribers when a module policy is dispatched', () => {
    const listener = jest.fn()
    subscribeToFormSectionPolicies(listener)

    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
    ])

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify when a dispatch changes nothing', () => {
    const listener = jest.fn()
    subscribeToFormSectionPolicies(listener)

    applyModuleOverridesFromEnabledModules([{ id: 'app' }, { id: 'other', overrides: { nav: { groupOrder: ['x'] } } }])

    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies on the programmatic tier too', () => {
    const listener = jest.fn()
    subscribeToFormSectionPolicies(listener)

    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToFormSectionPolicies(listener)
    unsubscribe()

    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps notifying the other subscribers when one throws', () => {
    const healthy = jest.fn()
    subscribeToFormSectionPolicies(() => {
      throw new Error('[internal] listener blew up')
    })
    subscribeToFormSectionPolicies(healthy)

    applyFormSectionPolicyOverrides({ [HOST]: { hidden: ['compliance'] } })

    expect(healthy).toHaveBeenCalledTimes(1)
  })
})

describe('forms.sections survives module duplication', () => {
  // Same hazard as the nav domain: the writer is app bootstrap while the reader is a form host in
  // `@open-mercato/core`, and standalone builds can evaluate `@open-mercato/shared` through more than
  // one module instance. A module-local variable would leave the second instance blind.
  it('a separately loaded module instance sees the value written by bootstrap', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { forms: { sections: { [HOST]: { hidden: ['compliance'] } } } } },
    ])

    let observed: unknown
    jest.isolateModules(() => {
      const freshModule = require('../overrides') as typeof import('../overrides')
      observed = freshModule.getFormSectionPolicy(HOST)
    })

    expect(observed).toEqual({ hidden: ['compliance'] })
  })
})
