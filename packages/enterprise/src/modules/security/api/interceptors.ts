import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig, requestMfaEmergencyBypassNotification } from '../lib/security-config'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { readSignInActivityConfig } from '../lib/sign-in-activity-config'
import { persistSignInMfaReceipt, reportSignInMfaFailure, type SignInMfaIdentity } from '../lib/sign-in-mfa-receipt'
import { MFA_ENROLLMENT_REQUIRED_CODE, MFA_NO_METHODS_CONFIGURED_CODE } from '../lib/mfa-error-codes'

const logger = createLogger('security').child({ component: 'auth-login-mfa-interceptor' })

type JwtClaims = {
  sub: string
  sid?: string | null
  tenantId?: string | null
  orgId?: string | null
  email?: string | null
  roles?: string[]
}

type MfaVerificationServiceLike = {
  createChallenge: (userId: string, signIn?: SignInMfaIdentity) => Promise<{
    challengeId: string
    availableMethods: Array<{ type: string; label: string; icon: string }>
  }>
}

function readClaims(token: string): JwtClaims | null {
  const payload = verifyJwt(token)
  if (!payload || typeof payload !== 'object') return null
  const sub = typeof payload.sub === 'string' ? payload.sub : null
  if (!sub) return null
  return {
    sub,
    sid: typeof payload.sid === 'string' ? payload.sid : null,
    tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
    orgId: typeof payload.orgId === 'string' ? payload.orgId : null,
    email: typeof payload.email === 'string' ? payload.email : null,
    roles: Array.isArray(payload.roles) ? payload.roles.filter((value: unknown): value is string => typeof value === 'string') : [],
  }
}

function resolveMfaVerificationService(container: { resolve: (name: string) => unknown }): MfaVerificationServiceLike | null {
  try {
    const resolved = container.resolve('mfaVerificationService')
    if (
      !resolved
      || typeof resolved !== 'object'
      || typeof (resolved as { createChallenge?: unknown }).createChallenge !== 'function'
    ) {
      return null
    }
    return resolved as MfaVerificationServiceLike
  } catch {
    return null
  }
}

const signInIdentitySchema = z.object({ tenantId: z.string().uuid(), userId: z.string().uuid(), attemptId: z.string().uuid() })

function readSignInIdentity(claims: JwtClaims): SignInMfaIdentity | undefined {
  if (!readSignInActivityConfig().enabled) return undefined
  const parsed = signInIdentitySchema.safeParse({
    tenantId: claims.tenantId, userId: claims.sub, attemptId: claims.sid,
  })
  if (parsed.success) return parsed.data
  reportSignInMfaFailure('security.sign_in_mfa_claims_invalid')
}

function classifyNoChallenge(error: unknown): 'not_required' | 'enrollment_required' | null {
  if (!(error instanceof Error) || error.name !== 'MfaVerificationServiceError' || !('code' in error)) return null
  if (error.code === MFA_NO_METHODS_CONFIGURED_CODE) return 'not_required'
  if (error.code === MFA_ENROLLMENT_REQUIRED_CODE) return 'enrollment_required'
  return null
}

async function recordNoChallenge(
  em: EntityManager,
  identity: SignInMfaIdentity | undefined,
  status: 'not_required' | 'enrollment_required' | 'bypassed',
) {
  if (!identity) return
  try {
    await em.transactional(async (transaction) => persistSignInMfaReceipt(transaction, identity, { status }))
  } catch {
    reportSignInMfaFailure('security.sign_in_mfa_receipt_failed')
  }
}

function reportMfaLoginFailure(
  error: unknown,
  code: 'security.mfa_service_unavailable' | 'security.mfa_challenge_creation_failed',
  message: string,
): void {
  try {
    logger.error(message, { err: error, code })
  } catch {
    // Never let a logger fault mask the fail-closed throw.
  }
  try {
    getTelemetryRuntime()?.reportError(error, { module: 'security', code })
  } catch (telemetryError) {
    try {
      logger.warn('Failed to report MFA login error to telemetry', { err: telemetryError, code })
    } catch {
      // Never let a telemetry fault mask the fail-closed throw.
    }
  }
}

export const interceptors: ApiInterceptor[] = [
  {
    id: 'security.auth.login.mfa-challenge',
    targetRoute: 'auth/login',
    methods: ['POST'],
    priority: 50,
    async after(_request, response, context) {
      if (response.statusCode !== 200) return {}
      if (response.body.ok !== true || response.body.mfa_required === true) return {}
      if (typeof response.body.token !== 'string' || response.body.token.length === 0) return {}

      const claims = readClaims(response.body.token)
      if (!claims) {
        if (readSignInActivityConfig().enabled) reportSignInMfaFailure('security.sign_in_mfa_claims_invalid')
        return {}
      }
      const signIn = readSignInIdentity(claims)

      // The emergency bypass is an explicit operator override and must keep working even
      // when the MFA service is degraded, so it is evaluated before service resolution.
      if (readSecurityModuleConfig().mfa.emergencyBypass) {
        emitMfaEmergencyBypassActiveWarning('login MFA challenge bypassed', { userId: claims.sub })
        await recordNoChallenge(context.em, signIn, 'bypassed')
        await requestMfaEmergencyBypassNotification({ tenantId: claims.tenantId, organizationId: claims.orgId })
        return {}
      }

      const mfaVerificationService = resolveMfaVerificationService(context.container as { resolve: (name: string) => unknown })
      if (!mfaVerificationService) {
        // Fail closed: without the MFA service we cannot know whether this account needs a
        // second factor, so the already-issued full staff token must not reach the caller.
        if (signIn) reportSignInMfaFailure('security.sign_in_mfa_service_unavailable')
        const unavailableError = new Error('[internal] MFA verification service unavailable for auth/login')
        reportMfaLoginFailure(
          unavailableError,
          'security.mfa_service_unavailable',
          'MFA verification service unavailable during auth/login; denying login',
        )
        throw unavailableError
      }

      try {
        const challenge = signIn
          ? await mfaVerificationService.createChallenge(claims.sub, signIn)
          : await mfaVerificationService.createChallenge(claims.sub)
        const pendingToken = signJwt(
          {
            sub: claims.sub,
            sid: claims.sid ?? undefined,
            tenantId: claims.tenantId ?? null,
            orgId: claims.orgId ?? null,
            email: claims.email ?? null,
            roles: claims.roles ?? [],
            mfa_pending: true,
            mfa_verified: false,
          },
          undefined,
          60 * 10,
        )
        return {
          replace: {
            ok: true,
            mfa_required: true,
            challenge_id: challenge.challengeId,
            available_methods: challenge.availableMethods,
            token: pendingToken,
          },
        }
      } catch (error) {
        // Only a verified no-MFA account may proceed with the pre-issued token. Any other
        // failure (reading methods, persisting the challenge, provider resolution) must
        // abort the login instead of returning the full JWT and refresh token.
        const noChallenge = classifyNoChallenge(error)
        if (noChallenge) {
          await recordNoChallenge(context.em, signIn, noChallenge)
          return {}
        }
        if (signIn) reportSignInMfaFailure('security.sign_in_mfa_challenge_failed')
        reportMfaLoginFailure(
          error,
          'security.mfa_challenge_creation_failed',
          'MFA challenge creation failed during auth/login; denying login',
        )
        throw error
      }
    },
  },
]
