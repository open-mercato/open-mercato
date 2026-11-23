import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { emitMfaEmergencyBypassActiveWarning, readSecurityModuleConfig, requestMfaEmergencyBypassNotification } from '../lib/security-config'
import { MFA_NO_METHODS_CONFIGURED_CODE } from '../lib/mfa-error-codes'

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
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === 'MfaVerificationServiceError' && candidate.code === MFA_NO_METHODS_CONFIGURED_CODE
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
        throw new Error('[internal] MFA verification service unavailable for auth/login')
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
        throw error
      }
    },
  },
]
