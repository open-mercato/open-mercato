export type AuthScopeInput = {
  tenantId?: string | null
  orgId?: string | null
}

export type ResolvedAssignmentScope = {
  tenantId: string | null
  organizationId: string | null
}

export type WidgetAssignmentTarget = {
  tenantId?: string | null
}

export type WidgetAssignmentTargetAccess = 'allowed' | 'forbidden' | 'not-found'

export function resolveWidgetAssignmentTargetAccess(params: {
  isSuperAdmin: boolean
  scopeTenantId: string | null
  target: WidgetAssignmentTarget | null | undefined
}): WidgetAssignmentTargetAccess {
  const { isSuperAdmin, scopeTenantId, target } = params
  if (!isSuperAdmin && !scopeTenantId) return 'forbidden'
  if (!target) return 'not-found'
  if (scopeTenantId && (target.tenantId ?? null) !== scopeTenantId) return 'not-found'
  return 'allowed'
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
