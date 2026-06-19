import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { enforceTenantSelection, resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { EnforcementScope, type MfaEnforcementPolicy } from '../../data/entities'
import type {
  EnforcementActorContext,
  MfaEnforcementServiceError,
  MfaEnforcementService,
} from '../../services/MfaEnforcementService'
import { localizeSecurityApiBody, securityApiError } from '../i18n'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type EnforcementRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  enforcementService: MfaEnforcementService
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeOrganizationList(values: unknown): string[] | null {
  if (values === null || values === undefined) return null
  if (!Array.isArray(values)) return null
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) result.push(trimmed)
  }
  return result
}

export async function resolveActorContext(ctx: EnforcementRequestContext): Promise<EnforcementActorContext> {
  const isSuperAdmin = await resolveIsSuperAdmin({ auth: ctx.auth, container: ctx.container })
  return {
    tenantId: normalizeNullableString(ctx.auth.tenantId),
    isSuperAdmin,
  }
}

async function assertActorOwnsOrganization(
  ctx: EnforcementRequestContext,
  organizationId: string,
): Promise<void> {
  const rbacService = ctx.container.resolve<RbacService>('rbacService')
  const acl = await rbacService.loadAcl(ctx.auth.sub, {
    tenantId: normalizeNullableString(ctx.auth.tenantId),
    organizationId: normalizeNullableString(ctx.auth.orgId),
  })
  const organizations = normalizeOrganizationList(acl?.organizations)
  if (organizations === null || organizations.includes('__all__')) return
  if (!organizations.includes(organizationId)) {
    throw forbidden('Not authorized to target this organization.')
  }
}

export async function assertActorOwnsEnforcementScope(
  ctx: EnforcementRequestContext,
  scope: EnforcementScope,
  scopeId: string | null | undefined,
): Promise<void> {
  if (scope === EnforcementScope.PLATFORM) {
    const isSuperAdmin = await resolveIsSuperAdmin({ auth: ctx.auth, container: ctx.container })
    if (!isSuperAdmin) {
      throw forbidden('Platform scope requires platform administrator privileges.')
    }
    return
  }

  if (scope === EnforcementScope.TENANT) {
    await enforceTenantSelection({ auth: ctx.auth, container: ctx.container }, scopeId)
    return
  }

  const normalizedScopeId = normalizeNullableString(scopeId)
  if (!normalizedScopeId) {
    throw new CrudHttpError(400, { error: "organisation scopeId must use '<tenantId>:<organizationId>' format" })
  }
  const [tenantId, organizationId] = normalizedScopeId.split(':')
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: "organisation scopeId must use '<tenantId>:<organizationId>' format" })
  }

  await enforceTenantSelection({ auth: ctx.auth, container: ctx.container }, tenantId)

  const isSuperAdmin = await resolveIsSuperAdmin({ auth: ctx.auth, container: ctx.container })
  if (isSuperAdmin) return
  await assertActorOwnsOrganization(ctx, organizationId)
}

export async function resolveEnforcementContext(req: Request): Promise<EnforcementRequestContext | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return securityApiError(401, 'Unauthorized')
  }

  const container = await createRequestContainer()
  return {
    auth,
    container,
    commandContext: {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: auth.orgId ? [auth.orgId] : null,
      request: req,
    },
    enforcementService: container.resolve<MfaEnforcementService>('mfaEnforcementService'),
  }
}

export async function mapEnforcementError(error: unknown): Promise<NextResponse> {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
  }
  if (isMfaEnforcementServiceError(error)) {
    return securityApiError(error.statusCode, error.message)
  }
  console.error('security.enforcement.route failure', error)
  return securityApiError(500, 'Failed to process enforcement request.')
}

export function toPolicyResponse(policy: MfaEnforcementPolicy): {
  id: string
  scope: string
  tenantId: string | null
  tenantName: string | null
  organizationId: string | null
  organizationName: string | null
  isEnforced: boolean
  allowedMethods: string[] | null
  enforcementDeadline: string | null
  enforcedBy: string
  createdAt: string
  updatedAt: string
} {
  return {
    id: policy.id,
    scope: policy.scope,
    tenantId: policy.tenantId ?? null,
    tenantName: null,
    organizationId: policy.organizationId ?? null,
    organizationName: null,
    isEnforced: policy.isEnforced,
    allowedMethods: policy.allowedMethods ?? null,
    enforcementDeadline: policy.enforcementDeadline ? policy.enforcementDeadline.toISOString() : null,
    enforcedBy: policy.enforcedBy,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  }
}

export async function attachPolicyScopeNames(
  container: RequestContainer,
  policies: MfaEnforcementPolicy[],
): Promise<Array<ReturnType<typeof toPolicyResponse>>> {
  if (policies.length === 0) return []

  const em = container.resolve<EntityManager>('em')
  const tenantIds = Array.from(
    new Set(
      policies
        .map((policy) => policy.tenantId ?? null)
        .filter((tenantId): tenantId is string => typeof tenantId === 'string' && tenantId.length > 0),
    ),
  )
  const organizationIds = Array.from(
    new Set(
      policies
        .map((policy) => policy.organizationId ?? null)
        .filter((organizationId): organizationId is string => typeof organizationId === 'string' && organizationId.length > 0),
    ),
  )

  const [tenants, organizations] = await Promise.all([
    tenantIds.length
      ? em.find(Tenant, { id: { $in: tenantIds }, deletedAt: null })
      : Promise.resolve([]),
    organizationIds.length
      ? em.find(Organization, { id: { $in: organizationIds }, deletedAt: null })
      : Promise.resolve([]),
  ])

  const tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
    const tenantId = tenant?.id ? String(tenant.id) : null
    if (!tenantId) return acc
    acc[tenantId] = typeof tenant.name === 'string' && tenant.name.length > 0 ? tenant.name : tenantId
    return acc
  }, {})
  const organizationMap = organizations.reduce<Record<string, string>>((acc, organization) => {
    const organizationId = organization?.id ? String(organization.id) : null
    if (!organizationId) return acc
    acc[organizationId] = typeof organization.name === 'string' && organization.name.length > 0
      ? organization.name
      : organizationId
    return acc
  }, {})

  return policies.map((policy) => {
    const response = toPolicyResponse(policy)
    return {
      ...response,
      tenantName: response.tenantId ? tenantMap[response.tenantId] ?? response.tenantId : null,
      organizationName: response.organizationId
        ? organizationMap[response.organizationId] ?? response.organizationId
        : null,
    }
  })
}

function isMfaEnforcementServiceError(error: unknown): error is MfaEnforcementServiceError {
  return error instanceof Error
    && error.name === 'MfaEnforcementServiceError'
    && typeof (error as Partial<MfaEnforcementServiceError>).statusCode === 'number'
}
