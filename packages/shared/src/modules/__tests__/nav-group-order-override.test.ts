/** @jest-environment node */

// `defaultGroupOrder` in `auth/lib/backendChrome.tsx` ranks any group it lists ahead of any group it
// does not, regardless of an app's own page `priority`/`order` — so a downstream app could not place its
// own primary module above the shipped groups by any documented means. `overrides.nav.groupOrder` wires
// that as a real override domain, which `BACKWARD_COMPATIBILITY.md` §2 explicitly reserves for additive
// wiring.

const mockLoggerWarn = jest.fn()

jest.mock('../../lib/logger', () => ({
  createLogger: () => {
    const child = { warn: (...args: unknown[]) => mockLoggerWarn(...args), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
    return { child: () => child, warn: child.warn, error: child.error, info: child.info, debug: child.debug }
  },
}))

import {
  applyModuleOverridesFromEnabledModules,
  getNavGroupOrderOverride,
  resetModuleContractOverridesForTests,
  resetModuleOverrideAppliersForTests,
} from '../overrides'

function reset() {
  resetModuleOverrideAppliersForTests()
  resetModuleContractOverridesForTests()
  mockLoggerWarn.mockClear()
}

beforeEach(reset)
afterEach(reset)

const collisionWarnings = () =>
  mockLoggerWarn.mock.calls.filter((call) => String(call[0]).includes('nav.groupOrder declared by more than one'))

describe('nav.groupOrder override domain', () => {
  it('is unset when no module declares it', () => {
    applyModuleOverridesFromEnabledModules([{ id: 'catalog' }, { id: 'sales', overrides: {} }])

    expect(getNavGroupOrderOverride()).toBeNull()
  })

  it('captures the ids a module declares, in order — proving the domain is wired', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { nav: { groupOrder: ['app.nav.group', 'catalog.nav.group'] } } },
    ])

    expect(getNavGroupOrderOverride()).toEqual(['app.nav.group', 'catalog.nav.group'])
    // An unwired domain would be dropped with a "not yet wired" warning instead of being captured.
    expect(mockLoggerWarn.mock.calls.filter((call) => String(call[0]).includes('not yet wired'))).toEqual([])
  })

  it('ignores an empty list, leaving the shipped ordering in charge', () => {
    applyModuleOverridesFromEnabledModules([{ id: 'app', overrides: { nav: { groupOrder: [] } } }])

    expect(getNavGroupOrderOverride()).toBeNull()
  })

  it('drops blank entries and de-duplicates while preserving first position', () => {
    applyModuleOverridesFromEnabledModules([
      {
        id: 'app',
        overrides: { nav: { groupOrder: ['  app.nav.group  ', '', '   ', 'app.nav.group', 'catalog.nav.group'] } },
      },
    ])

    expect(getNavGroupOrderOverride()).toEqual(['app.nav.group', 'catalog.nav.group'])
  })

  it('ignores a non-array value rather than throwing', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { nav: { groupOrder: 'app.nav.group' as never } } },
    ])

    expect(getNavGroupOrderOverride()).toBeNull()
  })

  it('lets the later module win when two declare an order, and says so', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'first', overrides: { nav: { groupOrder: ['first.nav.group'] } } },
      { id: 'second', overrides: { nav: { groupOrder: ['second.nav.group'] } } },
    ])

    expect(getNavGroupOrderOverride()).toEqual(['second.nav.group'])
    expect(collisionWarnings()).toHaveLength(1)
  })

  it('does not warn when the same module declares it twice', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { nav: { groupOrder: ['a.nav.group'] } } },
      { id: 'app', overrides: { nav: { groupOrder: ['b.nav.group'] } } },
    ])

    expect(getNavGroupOrderOverride()).toEqual(['b.nav.group'])
    expect(collisionWarnings()).toEqual([])
  })

  it('is cleared by the store reset hook so suites cannot leak into each other', () => {
    applyModuleOverridesFromEnabledModules([
      { id: 'app', overrides: { nav: { groupOrder: ['app.nav.group'] } } },
    ])
    expect(getNavGroupOrderOverride()).not.toBeNull()

    resetModuleContractOverridesForTests()

    expect(getNavGroupOrderOverride()).toBeNull()
  })
})
