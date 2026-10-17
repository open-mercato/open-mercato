/**
 * @jest-environment jsdom
 */
/**
 * The organization-scope version is the cache-busting key behind
 * `useOrganizationScopeVersion()`, which the monorepo reads in ~76 places
 * (dashboard, CRM, sales, settings, entities, translations) plus ~16
 * `useOrganizationScopeDetail()` readers.
 *
 * It used to start at 0 with a module scope of `{ organizationId: null, tenantId: null }`
 * — but that is a REAL scope value ("all organizations"), not "not known yet". So the
 * organization switcher announcing the scope it had just read back from `om_selected_org`
 * looked like null -> real id, counted as a change, and bumped the version to 1 on every
 * page load. Every keyed query then re-keyed onto a key the cache had no data for, so each
 * visit refetched scope-dependent data that had just been fetched for that same scope, and
 * screens gating render on the resulting `isLoading` blanked while it ran.
 *
 * The invariant asserted here is "initialisation is not a change, a real switch is".
 *
 * The seed runs ONCE at module initialisation rather than lazily from the readers,
 * and the `describe` block headed "a cookie rewritten just before the announcement"
 * is why: `OrganizationSwitcher.persistSelection()` writes both cookies and only
 * THEN emits, so a lazy seed reading on the first call into the module could adopt
 * the cookie the switcher had just written and swallow a genuine version bump. Two
 * of the three cases in that block report version 0 on the lazy shape; the third is
 * the baseline that passed under it, which is the point — the same page produced
 * different versions depending on mount order.
 *
 * The server half of the same invariant — no `document`, so no seed, and no
 * `window`, so no mutation — is in `organizationEvents.server.test.ts`, which needs
 * jest's `node` environment and therefore its own file.
 */
import type * as OrganizationEvents from '../organizationEvents'

type ScopeModule = typeof OrganizationEvents

const ORG = 'f21494dd-9918-45e6-9e0c-2f21fffadff7'
const OTHER_ORG = '11111111-2222-3333-4444-555555555555'
const TENANT = '44def49d-b3d5-4124-81df-72587e604861'
const OTHER_TENANT = '99999999-8888-7777-6666-555555555555'
/** Mirrors `ALL_ORGANIZATIONS_COOKIE_VALUE` in `@open-mercato/core` (modules/directory/constants). */
const ALL_ORGANIZATIONS = '__all__'

/**
 * A fresh module instance that sees exactly `cookies`. The scope is module-level
 * state seeded once per document, so every case needs its own registry — which is
 * also what makes this a faithful model of a page load.
 */
function loadWithCookies(cookies: Record<string, string>): ScopeModule {
  for (const name of ['om_selected_org', 'om_selected_tenant']) {
    document.cookie = `${name}=; path=/; max-age=0`
  }
  for (const [name, value] of Object.entries(cookies)) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/`
  }
  let mod!: ScopeModule
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../organizationEvents') as ScopeModule
  })
  return mod
}

describe('organization scope version: initialisation is not a change', () => {
  it('does not bump when the shell announces the scope the cookie already named', () => {
    const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)

    // The switcher's own load() reporting what it read back from the cookie. The
    // data already on screen was fetched by the server under this organization.
    scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })

    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)
  })

  it('still bumps on a real switch, so no screen reads the old organization under the new name', () => {
    const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
    scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })
    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)

    scope.emitOrganizationScopeChanged({ organizationId: OTHER_ORG, tenantId: TENANT })

    expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
    expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: OTHER_ORG, tenantId: TENANT })
  })

  it('bumps when the tenant changes under the same organization id', () => {
    const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
    scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: OTHER_TENANT })
    expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
  })

  it('treats the all-organizations sentinel as a scope, not as an unknown', () => {
    const scope = loadWithCookies({ om_selected_org: ALL_ORGANIZATIONS, om_selected_tenant: TENANT })
    expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: null, tenantId: TENANT })

    scope.emitOrganizationScopeChanged({ organizationId: null, tenantId: TENANT })

    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)
  })

  it('exposes the cookie scope to readers before anything has been announced', () => {
    // Components that read the scope synchronously on mount used to get a null
    // placeholder and correct themselves a beat later.
    const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
    expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: ORG, tenantId: TENANT })
  })

  it('still dispatches the first emission, so subscribers sync even when the version holds', () => {
    // The seed governs the VERSION; the existing hasEmitted/isFirstEmit guard governs
    // DISPATCH. They are orthogonal, and this pins that they stay so: a first
    // announcement repeating the cookie must still reach
    // `useOrganizationScopeDetail()` subscribers.
    const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
    const seen: OrganizationEvents.OrganizationScopeChangedDetail[] = []
    const unsubscribe = scope.subscribeOrganizationScopeChanged((detail) => { seen.push(detail) })

    scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })

    expect(seen).toEqual([{ organizationId: ORG, tenantId: TENANT }])
    expect(scope.getCurrentOrganizationScopeVersion()).toBe(0)
    unsubscribe()
  })

  describe('a cookie rewritten just before the announcement', () => {
    // `persistSelection()` writes both cookies and only then emits, and `load()`
    // reaches it whenever the stored cookie disagrees with the organization the
    // server resolved — an organization the user has lost access to, or one the
    // resolver rejected as non-existent. Every scope-keyed query on the page has
    // already fetched under the STALE cookie, so this announcement MUST bump:
    // without it nothing re-keys and the previous organization's rows stay on
    // screen under the new one's name.
    //
    // These cases are the whole reason the seed runs at module initialisation. The
    // first and third report 0 under a lazy seed; the second is the baseline they
    // are contrasted with, and it passed under it.

    it('bumps even though nothing read the scope first', () => {
      const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
      // Deliberately NO read here: the emission below is the first thing in this
      // tick to touch the module. A lazy seed would fire from inside it and adopt
      // the cookie the switcher had just written, hiding the change.
      document.cookie = `om_selected_org=${encodeURIComponent(OTHER_ORG)}; path=/`

      scope.emitOrganizationScopeChanged({ organizationId: OTHER_ORG, tenantId: TENANT })

      expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
      expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: OTHER_ORG, tenantId: TENANT })
    })

    it('bumps the same way when a component happened to read the scope first', () => {
      // The baseline the case above is contrasted with. It passed under the lazy
      // seed too — which is exactly the problem: the same page produced different
      // versions depending on mount order.
      const scope = loadWithCookies({ om_selected_org: ORG, om_selected_tenant: TENANT })
      expect(scope.getCurrentOrganizationScope()).toEqual({ organizationId: ORG, tenantId: TENANT })
      document.cookie = `om_selected_org=${encodeURIComponent(OTHER_ORG)}; path=/`

      scope.emitOrganizationScopeChanged({ organizationId: OTHER_ORG, tenantId: TENANT })

      expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
    })

    it('bumps when the tenant cookie is written on the way to the announcement', () => {
      // The subtler instance: with an org cookie but no tenant cookie, `load()`
      // calls `persistTenant(resolvedTenantId, { refresh: false })` — which writes
      // `om_selected_tenant` — before it emits. A lazy seed then reads a tenant the
      // server never resolved from.
      const scope = loadWithCookies({ om_selected_org: ORG })
      document.cookie = `om_selected_tenant=${encodeURIComponent(TENANT)}; path=/`

      scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })

      expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
    })
  })

  describe('an unreadable cookie falls back to the old, invalidating behaviour', () => {
    // With no selection cookie the server resolved the first render from the JWT's
    // organization, which the client cannot see. A first announcement naming a
    // different one MUST invalidate, so "unknown" has to mean "assume changed".
    it('bumps when there is no organization cookie', () => {
      const scope = loadWithCookies({ om_selected_tenant: TENANT })
      scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })
      expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
    })

    it('bumps when there is no tenant cookie', () => {
      const scope = loadWithCookies({ om_selected_org: ORG })
      scope.emitOrganizationScopeChanged({ organizationId: ORG, tenantId: TENANT })
      expect(scope.getCurrentOrganizationScopeVersion()).toBe(1)
    })
  })
})
