import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig, requestMfaEmergencyBypassNotification } from '../lib/security-config'
import { resolveMfaEnrollmentRedirect } from '../lib/enforcement-redirect'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { MFA_NO_METHODS_CONFIGURED_CODE } from '../lib/mfa-error-codes'

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
  createChallenge: (userId: string) => Promise<{
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

function isNoMfaMethodsConfiguredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { code?: unknown }
  return candidate.name === 'MfaVerificationServiceError' && candidate.code === MFA_NO_METHODS_CONFIGURED_CODE
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
      if (!claims) return {}

      // The emergency bypass is an explicit operator override and must keep working even
      // when the MFA service is degraded, so it is evaluated before service resolution.
      if (readSecurityModuleConfig().mfa.emergencyBypass) {
        emitMfaEmergencyBypassActiveWarning('login MFA challenge bypassed', { userId: claims.sub })
        await requestMfaEmergencyBypassNotification({ tenantId: claims.tenantId, organizationId: claims.orgId })
        return {}
      }

      const mfaVerificationService = resolveMfaVerificationService(context.container as { resolve: (name: string) => unknown })
      if (!mfaVerificationService) {
        // Fail closed: without the MFA service we cannot know whether this account needs a
        // second factor, so the already-issued full staff token must not reach the caller.
        const unavailableError = new Error('[internal] MFA verification service unavailable for auth/login')
        reportMfaLoginFailure(
          unavailableError,
          'security.mfa_service_unavailable',
          'MFA verification service unavailable during auth/login; denying login',
        )
        throw unavailableError
      }

      try {
        const challenge = await mfaVerificationService.createChallenge(claims.sub)
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
        if (isNoMfaMethodsConfiguredError(error)) return {}
        reportMfaLoginFailure(
          error,
          'security.mfa_challenge_creation_failed',
          'MFA challenge creation failed during auth/login; denying login',
        )
        throw error
      }
    },
  },
  {
    id: 'security.mfa.enrollment.api',
    targetRoute: '*',
    scope: 'request',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    priority: 100,
    async before(_request, context) {
      const auth = context.auth
      if (!auth || auth.isApiKey || auth.mfa_pending) return { ok: true }
      const routePattern = context.routePattern?.replace(/^\/+|\/+$/g, '').replace(/^api\//, '') ?? ''
      if (
        routePattern === 'auth/login'
        || routePattern === 'auth/logout'
        || routePattern === 'auth/profile'
        || routePattern === 'auth/session/refresh'
        || routePattern === 'security/profile'
        || routePattern === 'security/profile/password'
        || routePattern === 'security/mfa'
        || routePattern.startsWith('security/mfa/')
      ) return { ok: true }

      const enrollmentRedirect = await resolveMfaEnrollmentRedirect({
        auth,
        pathname: `/api/${routePattern}`,
        container: context.container,
        failClosed: true,
      })
      if (!enrollmentRedirect) return { ok: true }
      const { t } = await resolveTranslations()
      return { ok: false, statusCode: 403, message: t('security.profile.mfa.enforcement.notice.text') }
    },
  },
]
