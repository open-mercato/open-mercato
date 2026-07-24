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

export function getCurrentOrganizationScope(): OrganizationScopeChangedDetail {
  return { ...currentScope }
}

export function getCurrentOrganizationScopeVersion(): number {
  return currentVersion
}

export function emitOrganizationScopeChanged(detail: OrganizationScopeChangedDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  
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
