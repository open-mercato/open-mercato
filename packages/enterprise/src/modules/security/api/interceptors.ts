import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { readSecurityModuleConfig } from '../lib/security-config'

type JwtClaims = {
  sub: string
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
      if (readSecurityModuleConfig().mfa.emergencyBypass) return {}

      const claims = readClaims(response.body.token)
      if (!claims) return {}

      const mfaVerificationService = resolveMfaVerificationService(context.container as { resolve: (name: string) => unknown })
      if (!mfaVerificationService) return {}

      try {
        const challenge = await mfaVerificationService.createChallenge(claims.sub)
        const pendingToken = signJwt(
          {
            sub: claims.sub,
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
]
