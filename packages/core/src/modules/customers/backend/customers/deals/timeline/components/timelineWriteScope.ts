import { getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'

export function isTimelineScopeCurrent(scopeVersion: number): boolean {
  return getCurrentOrganizationScopeVersion() === scopeVersion
}
