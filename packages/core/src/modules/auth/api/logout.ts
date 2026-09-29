import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { buildSafeRedirectResponse } from '@open-mercato/core/modules/auth/lib/requestRedirect'
import { emitAuthEvent } from '@open-mercato/core/modules/auth/events'

type AuthTokenClaims = {
  userId: string | null
  sessionId: string | null
  tenantId: string | null
  organizationId: string | null
}

const emptyAuthTokenClaims: AuthTokenClaims = Object.freeze({
  userId: null,
  sessionId: null,
  tenantId: null,
  organizationId: null,
})

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

function readStringClaim(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function extractAuthTokenClaims(token: string | null): AuthTokenClaims {
  if (!token) return emptyAuthTokenClaims
  try {
    const payload = verifyJwt(token) as Record<string, unknown> | null
    if (!payload) return emptyAuthTokenClaims
    return {
      userId: readStringClaim(payload, 'sub'),
      sessionId: readStringClaim(payload, 'sid'),
      tenantId: readStringClaim(payload, 'tenantId'),
      organizationId: readStringClaim(payload, 'orgId'),
    }
  } catch {
    return emptyAuthTokenClaims
  }
}

export async function POST(req: Request) {
  const sessToken = parseCookie(req, 'session_token')
  const authToken = parseCookie(req, 'auth_token')
  const claims = extractAuthTokenClaims(authToken)
  let sessionRevoked = false
  if (sessToken || claims.sessionId) {
    try {
      const c = await createRequestContainer()
      const auth = c.resolve<AuthService>('authService')
      if (claims.sessionId) {
        await auth.deleteSessionById(claims.sessionId)
      }
      if (sessToken) {
        await auth.deleteSessionByToken(sessToken)
      }
      sessionRevoked = true
    } catch {}
  }
  if (claims.userId) {
    void emitAuthEvent('auth.logout', {
      id: claims.userId,
      tenantId: claims.tenantId,
      organizationId: claims.organizationId,
      sessionId: claims.sessionId,
      sessionRevoked,
      at: new Date().toISOString(),
    }, { persistent: true }).catch(() => undefined)
  }
  const res = buildSafeRedirectResponse(req, '/login')
  res.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  res.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  return res
}

export const metadata = {
  POST: { requireAuth: true },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Log out current session',
  methods: {
    POST: {
      summary: 'Invalidate session and redirect',
      description: 'Clears authentication cookies and redirects the browser to the login page.',
      responses: [
        { status: 302, description: 'Redirect to login after successful logout', mediaType: 'text/html' },
      ],
    },
  },
}
