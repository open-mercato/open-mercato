import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig } from '../lib/security-config'
import { signPendingMfaToken } from '../lib/mfa-pending-token'

const logger = createLogger('security').child({ component: 'login-mfa-interceptor' })

type JwtClaims = {
  sub: string
  sid?: string | null
  tenantId?: string | null
  orgId?: string | null
  email?: string | null
  roles?: string[]
}

type MfaVerificationServiceLike = {
  hasChallengeMethods: (userId: string) => Promise<boolean>
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
      || typeof (resolved as { hasChallengeMethods?: unknown }).hasChallengeMethods !== 'function'
      || typeof (resolved as { createChallenge?: unknown }).createChallenge !== 'function'
    ) {
      return null
    }
    return resolved as MfaVerificationServiceLike
  } catch {
    return null
  }
}

async function mfaUnavailableResponse() {
  const { translate } = await resolveTranslations()
  return {
    replace: {
      ok: false,
      code: 'MFA_UNAVAILABLE',
      error: translate(
        'security.login.errors.mfaUnavailable',
        'Multi-factor authentication is temporarily unavailable. Please try again.',
      ),
    },
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
      if (!claims?.sid) return await mfaUnavailableResponse()

      const mfaVerificationService = resolveMfaVerificationService(context.container as { resolve: (name: string) => unknown })
      if (!mfaVerificationService) {
        logger.error('MFA verification service is unavailable during login')
        return await mfaUnavailableResponse()
      }

      if (readSecurityModuleConfig().mfa.emergencyBypass) {
        emitMfaEmergencyBypassActiveWarning('login MFA challenge bypassed', { userId: claims.sub })
        return {}
      }

      try {
        if (!(await mfaVerificationService.hasChallengeMethods(claims.sub))) return {}
        const challenge = await mfaVerificationService.createChallenge(claims.sub)
        const pendingToken = signPendingMfaToken({
          sub: claims.sub,
          sid: claims.sid,
          tenantId: claims.tenantId ?? null,
          orgId: claims.orgId ?? null,
          email: claims.email ?? null,
          roles: claims.roles ?? [],
        })
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
        logger.error('MFA challenge creation failed during login', { err: error })
        return await mfaUnavailableResponse()
      }
    },
  },
]
