import type { AuthContext } from './server'

export type PrincipalScope = {
  tenantId: string
  organizationId: string
}

export type AuthPrincipalType = 'user' | 'role'

export type AuthPrincipalLabel = {
  id: string
  label: string
  secondary: string | null
}

export type AuthPrincipalRolePage = {
  items: AuthPrincipalLabel[]
  page: number
  pageSize: number
  total: number
}

/** Public, request-scoped read boundary owned by the Auth module. */
export interface AuthPrincipalService {
  principalExists(input: {
    type: AuthPrincipalType
    id: string
    scope: PrincipalScope
  }): Promise<boolean>
  resolveActiveUserRoleIds(userId: string, scope: PrincipalScope): Promise<string[]>
  filterActiveRoleIds(roleIds: string[], scope: PrincipalScope): Promise<string[]>
  resolveLabels(input: {
    type: AuthPrincipalType
    ids: string[]
    scope: PrincipalScope
  }): Promise<AuthPrincipalLabel[]>
  /**
   * Optional additive capability for organization-eligible role pickers.
   * Implementations must apply eligibility before pagination and bound the
   * advertised result window so sparse ACL matches cannot amplify requests.
   */
  queryActiveRolePage?(input: {
    scope: PrincipalScope
    search?: string
    excludedIds?: string[]
    page: number
    pageSize: number
  }): Promise<AuthPrincipalRolePage>
  listSuperAdminUserIds(tenantId: string): Promise<string[]>
}

/** Public, request-scoped read boundary owned by the API Keys module. */
export interface ApiKeyPrincipalService {
  resolveAssignedRoleIds(apiKeyId: string, scope: PrincipalScope): Promise<string[]>
}

export type OrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
  tenantId: string | null
  // True when an explicit organization selection could not be honored. Reads
  // fall back to the caller's accessible organizations; writes must fail.
  selectionRejected?: boolean
}

export type OrganizationScopeAcl = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

export type OrganizationScopeRequest = Request | {
  cookies?: { get: (name: string) => { value: string } | undefined }
  headers?: { get(name: string): string | null }
}

/**
 * Narrow, request-scoped hierarchy boundary owned by Directory.
 *
 * `null` means the selected organization does not exist in the requested
 * tenant. An empty array means it exists but has no ancestors.
 */
export interface OrganizationHierarchyService {
  resolveAncestorIds(input: {
    tenantId: string
    organizationId: string
  }): Promise<string[] | null>
}

/** Public, request-scoped organization expansion boundary owned by Directory. */
export interface OrganizationScopeService {
  resolve(input: {
    auth: AuthContext | null | undefined
    selectedId?: string | null
    tenantId?: string | null
    freshAcl?: boolean
  }): Promise<OrganizationScope>
  resolveFresh(input: {
    auth: NonNullable<AuthContext>
    selectedId?: string | null
    tenantId?: string | null
  }): Promise<{ scope: OrganizationScope; acl: OrganizationScopeAcl }>
  resolveForRequest(input: {
    auth: AuthContext | null | undefined
    request?: OrganizationScopeRequest
    selectedId?: string | null
    tenantId?: string | null
  }): Promise<OrganizationScope>
}
