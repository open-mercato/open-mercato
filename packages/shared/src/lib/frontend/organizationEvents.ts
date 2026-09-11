export const ORGANIZATION_SCOPE_CHANGED_EVENT = 'om:organization-scope-changed'

export type OrganizationScopeChangedDetail = {
  organizationId: string | null
  tenantId: string | null
}

// Module-level state to track current scope and version
let currentScope: OrganizationScopeChangedDetail = { 
  organizationId: null, 
  tenantId: null 
}
let currentVersion = 0
let hasEmitted = false

// ---------------------------------------------------------------------------
// Seeding the initial scope from the selection cookies
// ---------------------------------------------------------------------------
//
// `{ organizationId: null, tenantId: null }` is a REAL scope value ("all
// organizations"), not "not known yet", so the organization switcher announcing
// the scope it just read back from `om_selected_org` looked like null -> real id,
// counted as a change, and bumped `currentVersion` on every page load. That
// version is the cache-busting key behind `useOrganizationScopeVersion()`, so
// every scope-keyed query re-keyed onto a cold key and refetched data that had
// just been fetched for that same scope.
//
// The initial state therefore comes from the same cookies the SERVER resolved
// this document from (`resolveOrganizationScopeForRequest` /
// `resolveFeatureCheckContext`): "the cookie already said this" is precisely
// "what is on screen was fetched for this organization".
//
// What still bumps, deliberately:
//   - A real switch. The switcher calls `router.refresh()` rather than navigating,
//     so the client tree stays mounted; this re-key is the only thing stopping the
//     previous organization's rows being read under the new one's name. (For the
//     same reason `placeholderData: keepPreviousData` is NOT an alternative fix.)
//   - Either cookie being absent or unreadable, which leaves the seed at
//     `{ null, null }` and reproduces the previous behaviour exactly: without the
//     cookie the server fell back to the JWT's organization, which the client
//     cannot see, so a first announcement naming a different one MUST invalidate.
//
// Orthogonal to `hasEmitted`/`isFirstEmit` below, which governs event DISPATCH,
// not the version: a first announcement repeating the cookie still dispatches, so
// `useOrganizationScopeDetail()` subscribers sync while the version holds.
//
// MAINTAINER NOTE: the three constants below are duplicated rather than imported.
// `@open-mercato/shared` must not depend on `@open-mercato/core`, so it already
// inlines the same values twice — `ALL_ORGANIZATIONS_COOKIE_VALUE` and both cookie
// names in `lib/auth/server.ts`, and `SELECTED_ORG_COOKIE` in `lib/crud/factory.ts`
// — against `core`'s `modules/directory/constants`. This makes a third copy. The
// tidier resolution is to hoist all three into `shared` (say `lib/scope/cookies.ts`)
// and have `core/modules/directory/constants` re-export them; that touches a surface
// listed in BACKWARD_COMPATIBILITY.md, so it is a follow-up rather than part of this
// behaviour fix.
const SELECTED_ORG_COOKIE = 'om_selected_org'
const SELECTED_TENANT_COOKIE = 'om_selected_tenant'
/** Mirrors `ALL_ORGANIZATIONS_COOKIE_VALUE` in `@open-mercato/core` (modules/directory/constants). */
const ALL_ORGANIZATIONS_COOKIE_VALUE = '__all__'

/** The cookie's value, or `null` when the cookie is absent. An empty string IS a value. */
function readScopeCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trim()
    if (!trimmed.startsWith(prefix)) continue
    const raw = trimmed.slice(prefix.length)
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

/**
 * Browser-only, and called exactly ONCE at module initialisation (immediately
 * below) rather than lazily from the readers.
 *
 * LAZY WOULD BE WRONG, and not merely untidy. `persistSelection()` in
 * `OrganizationSwitcher` writes `om_selected_org`, then `om_selected_tenant`, and
 * only THEN emits. When that emission is the first thing to touch this module, a
 * lazy seed reads the cookie the switcher wrote a microsecond earlier,
 * `hasChanged` comes out false, and a genuine scope change does not bump — so
 * whether the version moves would depend on nothing more principled than whether
 * some component read the scope earlier in the same tick. That path is reachable:
 * `load()` calls `persistSelection()` to correct a cookie the server rejected (an
 * organization the user has lost access to), and every scope-keyed query on the
 * page has already fetched under the STALE cookie, so with no bump they never
 * re-key and the previous organization's rows stay on screen under the new one's
 * name.
 *
 * Module evaluation happens during hydration, before any component can rewrite
 * these cookies, so seeding here reads them while they still describe what the
 * server rendered — which is the whole premise of the seed — and makes the outcome
 * independent of call order.
 *
 * The `typeof document` guard is also why a single unconditional call is safe: on
 * the server this module is shared across requests, this call no-ops, and
 * `emitOrganizationScopeChanged` refuses to mutate state without a `window`, so the
 * server's view stays at `{ null, null }`.
 */
function seedScopeFromCookies(): void {
  if (typeof document === 'undefined') return
  const org = readScopeCookie(SELECTED_ORG_COOKIE)
  const tenant = readScopeCookie(SELECTED_TENANT_COOKIE)
  // Both have to be readable for the seed to describe what the server saw.
  if (org === null || tenant === null) return
  currentScope = {
    // The all-organizations sentinel is a scope, not an unknown.
    organizationId: !org || org === ALL_ORGANIZATIONS_COOKIE_VALUE ? null : org,
    tenantId: tenant || null,
  }
}

// Seeded here, at module initialisation, rather than lazily from the readers — see
// the note on `seedScopeFromCookies`.
seedScopeFromCookies()

export function getCurrentOrganizationScope(): OrganizationScopeChangedDetail {
  // Readers that run before the switcher has announced anything (search, chat
  // sessions) get the cookie scope instead of a null placeholder they would have
  // to correct a beat later.
  return { ...currentScope }
}

export function getCurrentOrganizationScopeVersion(): number {
  return currentVersion
}

export function emitOrganizationScopeChanged(detail: OrganizationScopeChangedDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return

  // `currentScope` was seeded from the cookies at module initialisation, so an
  // announcement that merely repeats them is not counted as a change.
  const hasChanged =
    currentScope.organizationId !== detail.organizationId ||
    currentScope.tenantId !== detail.tenantId
  // Guard so the very first emission always syncs subscribers, even when the
  // initial scope matches the default all-orgs `{ null, null }` state.
  const isFirstEmit = !hasEmitted
  
  // Update module-level state
  currentScope = { ...detail }
  hasEmitted = true
  
  // Increment version only if actual change detected
  if (hasChanged) {
    currentVersion++
  }
  
  // Only dispatch on real scope changes (or the first emission). Suppressing
  // no-op re-emits avoids spurious DataTable refreshes, chrome refetches, and
  // scope-hook churn when navigating between pages with the same scope.
  if (hasChanged || isFirstEmit) {
    window.dispatchEvent(new CustomEvent<OrganizationScopeChangedDetail>(ORGANIZATION_SCOPE_CHANGED_EVENT, { detail }))
  }
}

export function subscribeOrganizationScopeChanged(
  handler: (detail: OrganizationScopeChangedDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<OrganizationScopeChangedDetail>).detail ?? { organizationId: null, tenantId: null }
    handler(detail)
  }
  window.addEventListener(ORGANIZATION_SCOPE_CHANGED_EVENT, listener as EventListener)
  return () => {
    window.removeEventListener(ORGANIZATION_SCOPE_CHANGED_EVENT, listener as EventListener)
  }
}
