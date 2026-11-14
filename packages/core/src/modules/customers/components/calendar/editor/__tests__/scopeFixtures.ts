import type { OrganizationScopeChangedDetail } from '@open-mercato/shared/lib/frontend/organizationEvents'

export const orgA: OrganizationScopeChangedDetail = { tenantId: 'tenant-1', organizationId: 'org-a' }
export const orgB: OrganizationScopeChangedDetail = { tenantId: 'tenant-1', organizationId: 'org-b' }

export function clearScopeCookies(): void {
  document.cookie = 'om_selected_org=; Max-Age=0; path=/'
  document.cookie = 'om_selected_tenant=; Max-Age=0; path=/'
}

// Written the way the organization switcher persists a selection before reporting it.
export function writeScopeCookies(scope: OrganizationScopeChangedDetail): void {
  document.cookie = `om_selected_org=${encodeURIComponent(scope.organizationId ?? '__all__')}; path=/`
  document.cookie = scope.tenantId
    ? `om_selected_tenant=${encodeURIComponent(scope.tenantId)}; path=/`
    : 'om_selected_tenant=; Max-Age=0; path=/'
}

export type PendingRead = { resolve(value: unknown): void; reject(reason: unknown): void }

export function queueReads(mock: jest.Mock): PendingRead[] {
  const pending: PendingRead[] = []
  mock.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }))
  return pending
}
