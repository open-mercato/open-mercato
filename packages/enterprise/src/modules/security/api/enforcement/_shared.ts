import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { MfaEnforcementPolicy } from '../../data/entities'
import type { MfaEnforcementServiceError, MfaEnforcementService } from '../../services/MfaEnforcementService'
import { localizeSecurityApiBody, securityApiError } from '../i18n'

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type EnforcementRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  enforcementService: MfaEnforcementService
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
