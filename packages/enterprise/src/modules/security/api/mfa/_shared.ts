import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import '../../lib/mfaCompletionRoutes'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { MfaService, MfaServiceError } from '../../services/MfaService'
import type { MfaVerificationService, MfaVerificationServiceError } from '../../services/MfaVerificationService'
import { localizeSecurityApiBody, securityApiError } from '../i18n'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('security').child({ component: 'mfa' })
const MFA_MANAGE_FEATURE = 'security.mfa.manage'

const jsonRecordSchema = z.record(z.string(), z.unknown())

export type MfaRequestContext = {
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  container: Awaited<ReturnType<typeof createRequestContainer>>
  commandContext: CommandRuntimeContext
  mfaService: MfaService
  mfaVerificationService: MfaVerificationService
}

type MfaEnrollmentRbacService = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

type MfaEnrollmentEnforcementService = {
  checkUserCompliance: (userId: string) => Promise<{
    compliant: boolean
    enforced: boolean
  }>
}

export async function resolveMfaRequestContext(req: Request): Promise<MfaRequestContext | NextResponse> {
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
    mfaService: container.resolve<MfaService>('mfaService'),
    mfaVerificationService: container.resolve<MfaVerificationService>('mfaVerificationService'),
  }
}

export async function authorizeMfaEnrollmentMutation(
  context: Pick<MfaRequestContext, 'auth' | 'container'>,
): Promise<NextResponse | null> {
  const tenantId = typeof context.auth.tenantId === 'string' && context.auth.tenantId.trim().length > 0
    ? context.auth.tenantId.trim()
    : null
  const organizationId = typeof context.auth.orgId === 'string' && context.auth.orgId.trim().length > 0
    ? context.auth.orgId.trim()
    : null
  const rbacService = context.container.resolve<MfaEnrollmentRbacService>('rbacService')
  const canManageMfa = await rbacService.userHasAllFeatures(
    context.auth.sub,
    [MFA_MANAGE_FEATURE],
    { tenantId, organizationId },
  )
  if (canManageMfa) return null
  if (!tenantId) return securityApiError(403, 'Forbidden')

  try {
    const enforcementService = context.container.resolve<MfaEnrollmentEnforcementService>('mfaEnforcementService')
    const compliance = await enforcementService.checkUserCompliance(context.auth.sub)
    if (compliance.enforced && !compliance.compliant) return null
  } catch (error) {
    logger.error('Unable to verify compelled MFA enrollment authorization; allowing enrollment recovery path', {
      err: error,
    })
    return null
  }

  return securityApiError(403, 'Forbidden')
}

export async function readJsonRecord(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = jsonRecordSchema.safeParse(await req.json())
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function readUuidParam(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null
  const parsed = z.string().uuid().safeParse(value)
  return parsed.success ? parsed.data : null
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function mapMfaError(error: unknown): Promise<NextResponse> {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
  }
  const interceptorRejection = getCommandInterceptorHttpRejection(error)
  if (interceptorRejection) {
    return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  }
  if (isMfaServiceError(error) || isMfaVerificationServiceError(error)) {
    return securityApiError(error.statusCode, error.message)
  }
  logger.error('MFA route failure', { err: error })
  return securityApiError(500, 'Failed to process MFA request.')
}

function isMfaServiceError(error: unknown): error is MfaServiceError {
  return error instanceof Error
    && error.name === 'MfaServiceError'
    && typeof (error as Partial<MfaServiceError>).statusCode === 'number'
}

function isMfaVerificationServiceError(error: unknown): error is MfaVerificationServiceError {
  return error instanceof Error
    && error.name === 'MfaVerificationServiceError'
    && typeof (error as Partial<MfaVerificationServiceError>).statusCode === 'number'
}

export function issueVerifiedMfaToken(auth: MfaRequestContext['auth'], methods: string[]): string {
  const nextPayload: Record<string, unknown> = {
    sub: auth.sub,
    sid: typeof auth.sid === 'string' ? auth.sid : undefined,
    tenantId: auth.tenantId ?? null,
    orgId: auth.orgId ?? null,
    email: typeof auth.email === 'string' ? auth.email : null,
    roles: Array.isArray(auth.roles) ? auth.roles : [],
    mfa_pending: false,
    mfa_verified: true,
    mfa_methods: methods,
  }
  if (typeof auth.actorTenantId === 'string') {
    nextPayload.actorTenantId = auth.actorTenantId
  }
  if (typeof auth.actorOrgId === 'string') {
    nextPayload.actorOrgId = auth.actorOrgId
  }
  if (auth.isSuperAdmin === true) {
    nextPayload.isSuperAdmin = true
  }
  return signJwt({
    ...nextPayload,
  })
}

export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set('auth_token', token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  })
}
