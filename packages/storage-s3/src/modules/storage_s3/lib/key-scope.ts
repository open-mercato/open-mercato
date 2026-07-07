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

export function isS3KeyScopedToTenant(
  storagePath: string,
  scope: S3TenantScope | null | undefined,
  pathPrefix?: string,
): boolean {
  const segments = resolveScopeSegments(scope)
  if (!segments) return true

  const parts = splitS3Path(storagePath, pathPrefix)
  return parts.length >= 3
    && parts[1] === segments.orgSegment
    && parts[2] === segments.tenantSegment
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
