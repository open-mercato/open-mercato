import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isExplicitlyEmptyOrganizationScope, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { XeroScope } from './owner'
import { xeroErrorResponse } from './route-errors'

export const CREDENTIALS_MANAGE_FEATURE = 'integrations.credentials.manage'

export type AuthenticatedContext = Exclude<AuthContext, null>

export type RbacFeatureChecker = {
  userHasAllFeatures(
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

export type XeroRouteContext = {
  auth: AuthenticatedContext
  userId: string
  container: AppContainer
  scope: XeroScope
}

export type XeroRouteAuthResult = { ok: true; context: XeroRouteContext } | { ok: false; response: Response }

export function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function actsInAnotherTenant(auth: AuthenticatedContext): boolean {
  if (!('actorTenantId' in auth)) return false
  const actorTenantId = normalizeId(auth.actorTenantId)
  return actorTenantId === null || actorTenantId !== normalizeId(auth.tenantId)
}

export async function userHoldsFeatures(
  container: AppContainer,
  userId: string,
  features: string[],
  scope: XeroScope,
): Promise<boolean> {
  const rbacService = container.resolve<RbacFeatureChecker>('rbacService')
  return rbacService.userHasAllFeatures(userId, features, { tenantId: scope.tenantId, organizationId: scope.organizationId })
}

/**
 * The core route contract's rule 1, in its order: a super admin acting in another tenant, an
 * explicitly empty organization scope, the active organization, then `features` in that organization.
 */
export async function authorizeXeroRoute(
  req: Request,
  features: string[] = [CREDENTIALS_MANAGE_FEATURE],
): Promise<XeroRouteAuthResult> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return { ok: false, response: await xeroErrorResponse(401, 'unauthorized') }
  const tenantId = normalizeId(auth.tenantId)
  if (!tenantId) return { ok: false, response: await xeroErrorResponse(400, 'organization_scope_required') }
  if (actsInAnotherTenant(auth)) return { ok: false, response: await xeroErrorResponse(403, 'forbidden') }

  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  if (isExplicitlyEmptyOrganizationScope(organizationScope)) return { ok: false, response: await xeroErrorResponse(403, 'forbidden') }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { ok: false, response: await xeroErrorResponse(400, 'organization_scope_required') }

  const scope = { tenantId, organizationId }
  if (!(await userHoldsFeatures(container, auth.sub, features, scope))) {
    return { ok: false, response: await xeroErrorResponse(403, 'forbidden') }
  }
  return { ok: true, context: { auth, userId: auth.sub, container, scope } }
}
