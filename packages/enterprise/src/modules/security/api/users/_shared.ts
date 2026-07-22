import { NextResponse } from 'next/server'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceTenantSelection, resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { isSudoRequiredError } from '../../lib/sudo-middleware'
import type { MfaAdminService, MfaAdminServiceError } from '../../services/MfaAdminService'
import { localizeSecurityApiBody, securityApiError } from '../i18n'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('security').child({ component: 'users' })

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

export type SecurityUsersRequestContext = {
  auth: Auth
  container: RequestContainer
  commandContext: CommandRuntimeContext
  mfaAdminService: MfaAdminService
}

export async function resolveSecurityUsersContext(
  req: Request,
): Promise<SecurityUsersRequestContext | NextResponse> {
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
    mfaAdminService: container.resolve<MfaAdminService>('mfaAdminService'),
  }
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

export async function assertActorCanAccessSecurityUserTarget(
  ctx: SecurityUsersRequestContext,
  targetUserId: string,
): Promise<void> {
  const isSuperAdmin = await resolveIsSuperAdmin({ auth: ctx.auth, container: ctx.container })
  if (isSuperAdmin) return

  const em = ctx.container.resolve<EntityManager>('em')
  const target = await findOneWithDecryption(
    em,
    User,
    { id: targetUserId, deletedAt: null } as FilterQuery<User>,
    {},
    { tenantId: null, organizationId: null },
  )
  if (!target) {
    throw new CrudHttpError(404, { error: 'User not found' })
  }

  const actorTenantId = normalizeNullableString(ctx.auth.tenantId)
  const targetTenantId = normalizeNullableString((target as { tenantId?: string | null }).tenantId)
  if (!targetTenantId || targetTenantId !== actorTenantId) {
    throw new CrudHttpError(404, { error: 'User not found' })
  }

  const rbacService = ctx.container.resolve<RbacService>('rbacService')
  const acl = await rbacService.loadAcl(ctx.auth.sub, {
    tenantId: actorTenantId,
    organizationId: normalizeNullableString(ctx.auth.orgId),
  })
  const organizations = normalizeOrganizationList(acl?.organizations)
  if (organizations !== null && !organizations.includes('__all__')) {
    const targetOrganizationId = normalizeNullableString((target as { organizationId?: string | null }).organizationId)
    if (!targetOrganizationId || !organizations.includes(targetOrganizationId)) {
      throw forbidden('Not authorized to access this user.')
    }
  }
}

export async function assertActorOwnsTenantScope(
  ctx: SecurityUsersRequestContext,
  requestedTenantId: string | null | undefined,
): Promise<string | null> {
  const resolved = await enforceTenantSelection({ auth: ctx.auth, container: ctx.container }, requestedTenantId)
  return resolved ?? ctx.auth.tenantId ?? null
}

export async function mapSecurityUsersError(error: unknown): Promise<NextResponse> {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
  }
  if (isSudoRequiredError(error)) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.statusCode })
  }
  if (isMfaAdminServiceError(error)) {
    return securityApiError(error.statusCode, error.message)
  }

  logger.error('Users route failure', { err: error })
  return securityApiError(500, 'Failed to process user security request.')
}

function isMfaAdminServiceError(error: unknown): error is MfaAdminServiceError {
  return error instanceof Error
    && error.name === 'MfaAdminServiceError'
    && typeof (error as Partial<MfaAdminServiceError>).statusCode === 'number'
}
