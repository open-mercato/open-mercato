export type CustomerDetailKind = 'person' | 'company'

export type CustomerDetailAuthScope = {
  tenantId?: string | null
  isSuperAdmin?: boolean
}

export type CustomerDetailWhere = {
  id: string
  kind: CustomerDetailKind
  deletedAt: null
  tenantId?: string
}

export type CustomerDetailTenantScopeResult =
  | { allowed: true; where: CustomerDetailWhere }
  | { allowed: false; where: null }

export function resolveCustomerDetailTenantScope(
  id: string,
  kind: CustomerDetailKind,
  auth: CustomerDetailAuthScope,
): CustomerDetailTenantScopeResult {
  const tenantId = auth.tenantId ?? null
  const base: CustomerDetailWhere = { id, kind, deletedAt: null }

  if (tenantId) {
    return { allowed: true, where: { ...base, tenantId } }
  }

  if (auth.isSuperAdmin === true) {
    return { allowed: true, where: base }
  }

  return { allowed: false, where: null }
}
