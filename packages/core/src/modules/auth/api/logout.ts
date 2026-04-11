import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { buildRequestOriginUrl } from '@open-mercato/core/modules/auth/lib/requestRedirect'

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

export async function POST(req: Request) {
  const sessToken = parseCookie(req, 'session_token')
  if (sessToken) {
    try { const c = await createRequestContainer(); const auth = c.resolve<AuthService>('authService'); await auth.deleteSessionByToken(sessToken) } catch {}
  }
  const res = NextResponse.redirect(buildRequestOriginUrl(req, '/login'))
  res.cookies.set('auth_token', '', { httpOnly: true, path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 0 })
  res.cookies.set('session_token', '', { httpOnly: true, path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 0 })
  return res
}

export async function GET() {
  return NextResponse.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: 'POST' } })
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
      summary: 'Log out (legacy GET disabled)',
      description: 'GET logout is disabled because logout changes server-side session state. Use POST instead.',
      responses: [
        { status: 405, description: 'GET logout is not allowed', mediaType: 'application/json' },
      ],
    },
  },
}
