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
  organizationId?: string | null
}

export type WidgetAssignmentTargetAccess = 'allowed' | 'forbidden' | 'not-found'

export function resolveWidgetAssignmentTargetAccess(params: {
  isSuperAdmin: boolean
  scopeTenantId: string | null
  target: WidgetAssignmentTarget | null | undefined
  allowedOrganizationIds?: string[] | null
}): WidgetAssignmentTargetAccess {
  const { isSuperAdmin, scopeTenantId, target, allowedOrganizationIds } = params
  if (!isSuperAdmin && !scopeTenantId) return 'forbidden'
  if (!target) return 'not-found'
  if (scopeTenantId && (target.tenantId ?? null) !== scopeTenantId) return 'not-found'
  if (!isSuperAdmin && allowedOrganizationIds) {
    const targetOrganizationId = target.organizationId ?? null
    if (!targetOrganizationId || !allowedOrganizationIds.includes(targetOrganizationId)) return 'forbidden'
  }
  return 'allowed'
}

export function resolveWidgetAssignmentRecordScope(target: WidgetAssignmentTarget): ResolvedAssignmentScope {
  return {
    tenantId: target.tenantId ?? null,
    organizationId: target.organizationId ?? null,
  }
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
