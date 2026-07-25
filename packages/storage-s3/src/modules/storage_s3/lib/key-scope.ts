export type S3TenantScope = {
  organizationId?: string | null
  tenantId?: string | null
}

export type S3ScopedObject = {
  key: string
}

type ScopeSegments = {
  orgSegment: string
  tenantSegment: string
}

const SHARED_ORG_SEGMENT = 'org_shared'
const SHARED_TENANT_SEGMENT = 'tenant_shared'

function resolveSegment(value: string | null | undefined, prefix: 'org' | 'tenant'): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return `${prefix}_${trimmed}`
}

function resolveScopeSegments(scope: S3TenantScope | null | undefined): ScopeSegments | null {
  const orgSegment = resolveSegment(scope?.organizationId, 'org')
  const tenantSegment = resolveSegment(scope?.tenantId, 'tenant')
  if (!orgSegment || !tenantSegment) return null
  return { orgSegment, tenantSegment }
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, '')
}

function stripConfiguredPrefix(value: string, pathPrefix?: string): string {
  const normalized = normalizePath(value)
  const normalizedPrefix = normalizePath(pathPrefix ?? '')
  if (!normalizedPrefix) return normalized
  return normalized.startsWith(normalizedPrefix)
    ? normalized.slice(normalizedPrefix.length).replace(/^\/+/, '')
    : normalized
}

function splitS3Path(value: string, pathPrefix?: string): string[] {
  return stripConfiguredPrefix(value, pathPrefix).split('/').filter(Boolean)
}

function findScopeSegmentIndex(parts: string[]): number {
  return parts.findIndex((part, index) => (
    part.startsWith('org_') && parts[index + 1]?.startsWith('tenant_')
  ))
}

function hasScopeSegments(parts: string[], orgSegment: string, tenantSegment: string): boolean {
  const scopeIndex = findScopeSegmentIndex(parts)
  return scopeIndex >= 0
    && parts[scopeIndex] === orgSegment
    && parts[scopeIndex + 1] === tenantSegment
}

function resolveScopeSegmentsFromArgs(
  scopeOrOrgId: S3TenantScope | string | null | undefined,
  tenantId?: string,
): ScopeSegments | null {
  if (typeof scopeOrOrgId === 'string') {
    return resolveScopeSegments({ organizationId: scopeOrOrgId, tenantId })
  }
  return resolveScopeSegments(scopeOrOrgId)
}

export function isS3KeyScopedToTenant(key: string, orgId: string, tenantId: string): boolean
export function isS3KeyScopedToTenant(
  storagePath: string,
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): boolean
export function isS3KeyScopedToTenant(
  storagePath: string,
  scopeOrOrgId: S3TenantScope | string | null | undefined,
  pathPrefixOrTenantId?: string,
): boolean {
  const segments = resolveScopeSegmentsFromArgs(scopeOrOrgId, pathPrefixOrTenantId)
  if (!segments) return typeof scopeOrOrgId === 'string' ? false : true

  const pathPrefix = typeof scopeOrOrgId === 'string' ? undefined : pathPrefixOrTenantId
  const parts = splitS3Path(storagePath, pathPrefix)
  return hasScopeSegments(parts, segments.orgSegment, segments.tenantSegment)
}

export function isS3KeyShared(key: string): boolean {
  return hasScopeSegments(splitS3Path(key), SHARED_ORG_SEGMENT, SHARED_TENANT_SEGMENT)
}

export function isS3KeyAddressableByScope(key: string, orgId: string, tenantId: string): boolean {
  return isS3KeyScopedToTenant(key, orgId, tenantId) || isS3KeyShared(key)
}

export function isS3KeyAddressableByTenantScope(
  storagePath: string,
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): boolean {
  if (!resolveScopeSegments(scope)) return true
  const parts = splitS3Path(storagePath, pathPrefix)
  return isS3KeyScopedToTenant(storagePath, scope, pathPrefix)
    || hasScopeSegments(parts, SHARED_ORG_SEGMENT, SHARED_TENANT_SEGMENT)
}

export function assertS3KeyScopedToTenant(
  storagePath: string,
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): void {
  if (!isS3KeyScopedToTenant(storagePath, scope, pathPrefix)) {
    throw new Error('S3 key is not scoped to the active tenant')
  }
}

export function assertS3KeyAddressableByTenantScope(
  storagePath: string,
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): void {
  if (!isS3KeyAddressableByTenantScope(storagePath, scope, pathPrefix)) {
    throw new Error('S3 key is not scoped to the active tenant')
  }
}

export function assertS3ListPrefixScopedToTenant(
  prefix: string,
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): void {
  const segments = resolveScopeSegments(scope)
  if (!segments) return

  const parts = splitS3Path(prefix, pathPrefix)
  if (parts.length === 0) return

  if (parts[0]?.startsWith('org_') || parts[1]?.startsWith('tenant_')) {
    if (parts[0] !== segments.orgSegment || parts[1] !== segments.tenantSegment) {
      throw new Error('S3 prefix is not scoped to the active tenant')
    }
    return
  }

  if (
    (parts[1]?.startsWith('org_') && parts[1] !== segments.orgSegment)
    || (parts[2]?.startsWith('tenant_') && parts[2] !== segments.tenantSegment)
  ) {
    throw new Error('S3 prefix is not scoped to the active tenant')
  }
}

export function filterS3ObjectsToTenant<T extends S3ScopedObject>(
  files: T[],
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): T[] {
  if (!resolveScopeSegments(scope)) return files
  return files.filter((file) => isS3KeyScopedToTenant(file.key, scope, pathPrefix))
}
