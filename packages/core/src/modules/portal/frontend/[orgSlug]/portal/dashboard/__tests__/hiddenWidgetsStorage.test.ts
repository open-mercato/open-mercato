/** @jest-environment jsdom */
import {
  loadHiddenWidgets,
  saveHiddenWidgets,
  clearLegacyHiddenWidgetsKey,
} from '../hiddenWidgetsStorage'

const LEGACY_KEY = 'om:portal:dashboard:hidden'

describe('portal dashboard hidden widgets storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not leak hidden widgets between org/user scopes', () => {
    saveHiddenWidgets('org-a', 'user-1', new Set(['widget-1']))
    saveHiddenWidgets('org-b', 'user-2', new Set(['widget-2']))

    expect(loadHiddenWidgets('org-a', 'user-1')).toEqual(new Set(['widget-1']))
    expect(loadHiddenWidgets('org-b', 'user-2')).toEqual(new Set(['widget-2']))
    expect(loadHiddenWidgets('org-a', 'user-2')).toEqual(new Set())
    expect(loadHiddenWidgets('org-b', 'user-1')).toEqual(new Set())
  })

  it('ignores the legacy unscoped key when loading a scoped preference', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['legacy-widget']))
    expect(loadHiddenWidgets('org-a', 'user-1')).toEqual(new Set())
  })

  it('clears the legacy unscoped key', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['legacy-widget']))
    clearLegacyHiddenWidgetsKey()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('falls back to an empty set on malformed or outdated envelopes', () => {
    localStorage.setItem('om:portal:dashboard:hidden:v1:org-a:user-1', 'not-json')
    expect(loadHiddenWidgets('org-a', 'user-1')).toEqual(new Set())

    localStorage.setItem('om:portal:dashboard:hidden:v1:org-a:user-2', JSON.stringify(['bare-array']))
    expect(loadHiddenWidgets('org-a', 'user-2')).toEqual(new Set())

    localStorage.setItem('om:portal:dashboard:hidden:v1:org-a:user-3', JSON.stringify({ v: 2, hidden: ['x'] }))
    expect(loadHiddenWidgets('org-a', 'user-3')).toEqual(new Set())
  })
})
