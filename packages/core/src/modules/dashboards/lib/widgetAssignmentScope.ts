export type AuthScopeInput = {
  tenantId?: string | null
  orgId?: string | null
}

export type ResolvedAssignmentScope = {
  tenantId: string | null
  organizationId: string | null
}

export function resolveWidgetAssignmentReadScope(params: {
  auth: AuthScopeInput
  isSuperAdmin: boolean
  queryTenantId?: string | null
  queryOrganizationId?: string | null
}): ResolvedAssignmentScope {
  const { auth, isSuperAdmin, queryTenantId, queryOrganizationId } = params
  if (isSuperAdmin) {
    return {
      tenantId: (queryTenantId && queryTenantId.length ? queryTenantId : auth.tenantId) ?? null,
      organizationId:
        (queryOrganizationId && queryOrganizationId.length ? queryOrganizationId : auth.orgId) ?? null,
    }
  }
  return {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  }
}
