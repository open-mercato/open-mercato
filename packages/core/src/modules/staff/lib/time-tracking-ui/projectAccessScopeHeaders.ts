export const PROJECT_SCOPE_TENANT_HEADER = 'x-om-project-scope-tenant-id'
export const PROJECT_SCOPE_ORGANIZATION_HEADER = 'x-om-project-scope-organization-id'

export type ResolvedProjectAccessScope = {
  tenantId: string
  organizationId: string
}

export function readResolvedProjectAccessScope(
  response: { headers?: Pick<Headers, 'get'> },
): ResolvedProjectAccessScope | null {
  const tenantId = response.headers?.get(PROJECT_SCOPE_TENANT_HEADER)
  const organizationId = response.headers?.get(PROJECT_SCOPE_ORGANIZATION_HEADER)
  return tenantId && organizationId ? { tenantId, organizationId } : null
}
