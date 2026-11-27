import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
<<<<<<< HEAD
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig } from '../lib/security-config'
=======
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig, requestMfaEmergencyBypassNotification } from '../lib/security-config'
import { resolveMfaEnrollmentRedirect } from '../lib/enforcement-redirect'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { MFA_NO_METHODS_CONFIGURED_CODE } from '../lib/mfa-error-codes'

const logger = createLogger('security').child({ component: 'auth-login-mfa-interceptor' })
>>>>>>> 9b70edf065 (fix(security): enforce MFA enrollment before business APIs (#9152) (#9753))

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

      const mfaVerificationService = resolveMfaVerificationService(context.container as { resolve: (name: string) => unknown })
      if (!mfaVerificationService) return {}

      if (readSecurityModuleConfig().mfa.emergencyBypass) {
        emitMfaEmergencyBypassActiveWarning('login MFA challenge bypassed', { userId: claims.sub })
        return {}
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
      } catch {
        return {}
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
