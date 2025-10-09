export const ORGANIZATION_SCOPE_CHANGED_EVENT = 'om:organization-scope-changed'

export type OrganizationScopeChangedDetail = {
  organizationId: string | null
}

export function emitOrganizationScopeChanged(detail: OrganizationScopeChangedDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent<OrganizationScopeChangedDetail>(ORGANIZATION_SCOPE_CHANGED_EVENT, { detail }))
}

export function subscribeOrganizationScopeChanged(
  handler: (detail: OrganizationScopeChangedDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<OrganizationScopeChangedDetail>).detail ?? { organizationId: null }
    handler(detail)
  }
  window.addEventListener(ORGANIZATION_SCOPE_CHANGED_EVENT, listener as EventListener)
  return () => {
    window.removeEventListener(ORGANIZATION_SCOPE_CHANGED_EVENT, listener as EventListener)
  }
}
