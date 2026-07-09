const SHARED_ORG_SEGMENT = 'org_shared'
const SHARED_TENANT_SEGMENT = 'tenant_shared'

function findScopeSegmentIndex(parts: string[]): number {
  return parts.findIndex((part, index) => (
    part.startsWith('org_') && parts[index + 1]?.startsWith('tenant_')
  ))
}

function hasScopeSegments(key: string, orgSegment: string, tenantSegment: string): boolean {
  const parts = key.split('/')
  const scopeIndex = findScopeSegmentIndex(parts)
  return scopeIndex >= 0
    && parts[scopeIndex] === orgSegment
    && parts[scopeIndex + 1] === tenantSegment
}

export function isS3KeyScopedToTenant(key: string, orgId: string, tenantId: string): boolean {
  if (!orgId || !tenantId) return false
  return hasScopeSegments(key, `org_${orgId}`, `tenant_${tenantId}`)
}

export function isS3KeyShared(key: string): boolean {
  return hasScopeSegments(key, SHARED_ORG_SEGMENT, SHARED_TENANT_SEGMENT)
}

export function isS3KeyAddressableByScope(key: string, orgId: string, tenantId: string): boolean {
  return isS3KeyScopedToTenant(key, orgId, tenantId) || isS3KeyShared(key)
}
