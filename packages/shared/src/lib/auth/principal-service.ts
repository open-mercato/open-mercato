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
