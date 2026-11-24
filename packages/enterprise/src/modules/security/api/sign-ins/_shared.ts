import { NextResponse } from 'next/server'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { SignInAttempt } from '../../data/entities'
import type { AdminSignInQuery } from '../../data/sign-in-query-validators'
import { readSignInActivityConfig } from '../../lib/sign-in-activity-config'
import { securityApiError } from '../i18n'

export const signInAdminMetadata = {
  GET: { requireAuth: true, requireFeatures: ['security.sign_ins.view'] },
}

export async function signInNotFound() {
  const { translate } = await resolveTranslations()
  return NextResponse.json({ error: translate('api.errors.notFound', 'Not found') }, { status: 404 })
}

export async function resolveSignInContext(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub) return securityApiError(401, 'Unauthorized')
  if (!auth.tenantId) return securityApiError(403, 'Tenant context is required.')
  const config = readSignInActivityConfig()
  if (!config.enabled) return signInNotFound()
  const container = await createRequestContainer()
  return { auth, tenantId: auth.tenantId, config, container, em: container.resolve<EntityManager>('em') }
}

export async function resolveAdminSignInContext(request: Request) {
  const context = await resolveSignInContext(request)
  if (context instanceof NextResponse) return context
  const scope = await resolveOrganizationScopeForRequest({
    container: context.container,
    auth: context.auth,
    request,
  })
  if (scope.tenantId !== context.tenantId) return securityApiError(403, 'Forbidden')
  const organizationIds = scope.filterIds ?? scope.allowedIds
  return { ...context, organizationIds }
}

export function organizationFilter(organizationIds: string[] | null) {
  if (organizationIds === null) return {}
  if (organizationIds.length === 0) return { organizationId: null }
  return { $or: [{ organizationId: null }, { organizationId: { $in: organizationIds } }] }
}

export function buildAdminSignInFilter(
  tenantId: string,
  organizationIds: string[] | null,
  query: AdminSignInQuery,
): FilterQuery<SignInAttempt> {
  const { userId, email, result, ip, from, to } = query
  return {
    tenantId,
    ...organizationFilter(organizationIds),
    ...(userId ? { userId } : {}),
    ...(email ? { emailHash: { $in: lookupHashCandidates(email.toLowerCase()) } } : {}),
    ...(result ? { result } : {}),
    ...(ip ? { ipHash: { $in: lookupHashCandidates(ip) } } : {}),
    ...(from || to ? {
      occurredAt: {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      },
    } : {}),
  }
}

export function toProfileSignInDto(attempt: SignInAttempt) {
  return {
    id: attempt.id,
    occurredAt: attempt.occurredAt.toISOString(),
    result: attempt.result,
    reason: attempt.reason ?? null,
    ipAddress: attempt.ipAddress ?? null,
    userAgent: attempt.userAgent ?? null,
    browserName: attempt.browserName ?? null,
    browserMajor: attempt.browserMajor ?? null,
    osName: attempt.osName ?? null,
    deviceType: attempt.deviceType,
    isNewDevice: attempt.isNewDevice,
    mfaStatus: attempt.mfaStatus ?? null,
  }
}

export async function loadSignInUserNames(
  em: EntityManager,
  tenantId: string,
  organizationIds: string[] | null,
  attempts: SignInAttempt[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(attempts.flatMap((attempt) => attempt.userId ? [attempt.userId] : []))]
  if (ids.length === 0) return new Map()
  const users = await findWithDecryption<User>(em, User, {
    tenantId,
    ...organizationFilter(organizationIds),
    id: { $in: ids },
    deletedAt: null,
  }, { fields: ['id', 'tenantId', 'organizationId', 'name'] }, { tenantId })
  return new Map(users.map((user) => [user.id, user.name ?? null]))
}

export function toAdminSignInDto(attempt: SignInAttempt, names: Map<string, string | null>) {
  return {
    ...toProfileSignInDto(attempt),
    userId: attempt.userId ?? null,
    email: attempt.email,
    userName: attempt.userId ? names.get(attempt.userId) ?? null : null,
  }
}
