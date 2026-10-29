export const ORGANIZATION_SCOPE_CHANGED_EVENT = 'om:organization-scope-changed'

export type OrganizationScopeChangedDetail = {
  organizationId: string | null
  tenantId: string | null
}

function readPersistedScope(): OrganizationScopeChangedDetail {
  if (typeof document === 'undefined') return { organizationId: null, tenantId: null }
  const cookies = document.cookie.split(';').map((entry) => entry.trim())
  const readSelection = (name: string): string | null => {
    const entry = cookies.find((cookie) => cookie.startsWith(`${name}=`))
    const raw = entry?.slice(name.length + 1)
    if (!raw) return null
    try { return decodeURIComponent(raw) || null } catch { return raw }
  }
  const organizationId = readSelection('om_selected_org')
  return {
    organizationId: organizationId === '__all__' ? null : organizationId,
    tenantId: readSelection('om_selected_tenant'),
  }
}

const initialPersistedScope = readPersistedScope()
let currentScope: OrganizationScopeChangedDetail = { organizationId: null, tenantId: null }
let currentVersion = 0
let hasEmitted = false

export function getCurrentOrganizationScope(): OrganizationScopeChangedDetail {
  return { ...currentScope }
}

export function getCurrentOrganizationScopeVersion(): number {
  return currentVersion
}

export function emitOrganizationScopeChanged(detail: OrganizationScopeChangedDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  
  // Detect actual changes
  const previousScope = hasEmitted ? currentScope : initialPersistedScope
  const hasChanged = 
    previousScope.organizationId !== detail.organizationId ||
    previousScope.tenantId !== detail.tenantId
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
