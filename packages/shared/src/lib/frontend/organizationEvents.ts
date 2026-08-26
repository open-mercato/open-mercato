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
// `currentScope` cannot usefully start at `{ organizationId: null, tenantId: null }`,
// because that is a REAL scope value ("all organizations") rather than "not known
// yet". Nothing downstream can tell the two apart, so the very first announcement
// from the organization switcher — which reports the scope it has just read back
// from `om_selected_org` — looked like null -> real id, i.e. a change, and bumped
// `currentVersion` 0 -> 1 on every page load.
//
// That version is the cache-busting key behind `useOrganizationScopeVersion()`,
// which this repo uses in ~76 places (dashboard, CRM, sales, settings, entities,
// translations), alongside ~16 `useOrganizationScopeDetail()` readers. A spurious
// bump re-keys every one of those queries onto a key the query cache has no data
// for, so each visit paid for a full refetch of scope-dependent data that had just
// been fetched for exactly that scope. Screens that gate their render on the
// resulting `isLoading` additionally blanked their body for the duration of the
// refetch, once per visit, with nothing on screen to explain it.
//
// The fix seeds the module scope from the same cookies the SERVER resolved this
// document from (`resolveOrganizationScopeForRequest` / `resolveFeatureCheckContext`),
// so "the cookie already said this" is precisely "what is on screen was fetched for
// this organization", and repeating it is initialisation rather than a change.
//
// What still bumps, deliberately:
//   - A real switch. The switcher calls `router.refresh()` rather than navigating,
//     so the client tree stays mounted; this re-key is the only thing stopping the
//     previous organization's rows being read under the new one's name. (For the
//     same reason `placeholderData: keepPreviousData` is NOT an alternative fix —
//     across a real switch it would render the previous organization's data.)
//   - Either cookie being absent or unreadable, which leaves the seed at
//     `{ null, null }` and reproduces the previous behaviour exactly. This is the
//     conservative direction: without the cookie the server fell back to the JWT's
//     organization, which the client cannot see, so a first announcement naming a
//     different one MUST invalidate.
//
// Note this is orthogonal to `hasEmitted`/`isFirstEmit` below, which governs event
// DISPATCH, not the version. A first announcement that merely repeats the cookie
// still dispatches — so `useOrganizationScopeDetail()` subscribers sync — while
// `useOrganizationScopeVersion()` correctly stays put.
//
// MAINTAINER NOTE: the three constants below are duplicated rather than imported.
// `@open-mercato/shared` must not depend on `@open-mercato/core`, so it already
// inlines the same values twice — `ALL_ORGANIZATIONS_COOKIE_VALUE` and both cookie
// names in `lib/auth/server.ts`, and `SELECTED_ORG_COOKIE` in `lib/crud/factory.ts`
// — against `core`'s `modules/directory/constants`. This makes a third copy. The
// tidier resolution, if maintainers want it, is to hoist all three into `shared`
// (say `lib/scope/cookies.ts`) and have `core/modules/directory/constants` re-export
// them for backward compatibility; that is a mechanical change touching more files
// than this fix needs, so it is left as a follow-up rather than bundled here.
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

let scopeSeeded = false

/**
 * Idempotent and browser-only. Deliberately never memoizes on the server: this
 * module is shared across requests there, and `emitOrganizationScopeChanged`
 * refuses to mutate state without a `window`, so the server's view must stay at
 * `{ null, null }`.
 */
function seedScopeFromCookies(): void {
  if (scopeSeeded || typeof document === 'undefined') return
  scopeSeeded = true
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

export function getCurrentOrganizationScope(): OrganizationScopeChangedDetail {
  // Readers that run before the switcher has announced anything (search, chat
  // sessions) get the cookie scope instead of a null placeholder they would have
  // to correct a beat later.
  seedScopeFromCookies()
  return { ...currentScope }
}

export function getCurrentOrganizationScopeVersion(): number {
  return currentVersion
}

export function emitOrganizationScopeChanged(detail: OrganizationScopeChangedDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return

  // Adopt the cookie scope before the first comparison, so an announcement that
  // merely repeats it is not counted as a change. See the block above `readScopeCookie`.
  seedScopeFromCookies()
  
  // Detect actual changes
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
