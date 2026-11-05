import type {
  ApiKeyPrincipalService,
  AuthPrincipalService,
  OrganizationScopeService,
} from '@open-mercato/shared/lib/auth/principal-service'

export type DocumentsServiceContainer = {
  resolve(name: string): unknown
}

export type DocumentsRbacService = {
  userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

function tryResolve(container: DocumentsServiceContainer | null | undefined, name: string): unknown {
  if (!container) return null
  try {
    return container.resolve(name)
  } catch {
    return null
  }
}

export function resolveAuthPrincipalService(
  container: DocumentsServiceContainer | null | undefined,
): AuthPrincipalService | null {
  const service = tryResolve(container, 'authPrincipalService') as Partial<AuthPrincipalService> | null
  if (!service
    || typeof service.principalExists !== 'function'
    || typeof service.resolveActiveUserRoleIds !== 'function'
    || typeof service.filterActiveRoleIds !== 'function'
    || typeof service.resolveLabels !== 'function'
    || typeof service.listSuperAdminUserIds !== 'function') return null
  return service as AuthPrincipalService
}

export function resolveApiKeyPrincipalService(
  container: DocumentsServiceContainer | null | undefined,
): ApiKeyPrincipalService | null {
  const service = tryResolve(container, 'apiKeyPrincipalService') as Partial<ApiKeyPrincipalService> | null
  return service && typeof service.resolveAssignedRoleIds === 'function'
    ? service as ApiKeyPrincipalService
    : null
}

export function resolveDocumentsRbacService(
  container: DocumentsServiceContainer | null | undefined,
): DocumentsRbacService | null {
  const service = tryResolve(container, 'rbacService') as Partial<DocumentsRbacService> | null
  return service && typeof service.userHasAllFeatures === 'function'
    ? service as DocumentsRbacService
    : null
}

export function resolveOrganizationScopeService(
  container: DocumentsServiceContainer | null | undefined,
): OrganizationScopeService | null {
  const service = tryResolve(container, 'organizationScopeService') as Partial<OrganizationScopeService> | null
  if (!service
    || typeof service.resolve !== 'function'
    || typeof service.resolveFresh !== 'function'
    || typeof service.resolveForRequest !== 'function') {
    return null
  }
  return service as OrganizationScopeService
}
