import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { toAbsoluteUrl } from '@open-mercato/shared/lib/url'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { verifyJwt } from '@open-mercato/shared/lib/auth/jwt'

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

function extractSessionIdFromAuthToken(token: string | null): string | null {
  if (!token) return null
  try {
    const payload = verifyJwt(token) as Record<string, unknown> | null
    if (!payload) return null
    const sid = payload.sid
    return typeof sid === 'string' && sid.length > 0 ? sid : null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const sessToken = parseCookie(req, 'session_token')
  const authToken = parseCookie(req, 'auth_token')
  const sessionId = extractSessionIdFromAuthToken(authToken)
  if (sessToken || sessionId) {
    try {
      const c = await createRequestContainer()
      const auth = c.resolve<AuthService>('authService')
      if (sessionId) {
        await auth.deleteSessionById(sessionId)
      }
      if (sessToken) {
        await auth.deleteSessionByToken(sessToken)
      }
    } catch {}
  }
  const res = NextResponse.redirect(toAbsoluteUrl(req, '/login'))
  res.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  res.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  return POST(req)
}

export const metadata = {
  GET: { requireAuth: true },
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
    GET: {
      summary: 'Log out (legacy GET)',
      description: 'For convenience, the GET variant performs the same logout logic as POST and issues a redirect.',
      responses: [
        { status: 302, description: 'Redirect to login after successful logout', mediaType: 'text/html' },
      ],
    },
  },
}
