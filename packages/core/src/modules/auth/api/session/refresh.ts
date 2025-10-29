import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@/lib/auth/jwt'
import { z } from 'zod'

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const redirectTo = url.searchParams.get('redirect') || '/'
  const toAbs = (p: string) => new URL(p, url.origin).toString()
  const token = parseCookie(req, 'session_token')
  if (!token) return NextResponse.redirect(toAbs('/login?redirect=' + encodeURIComponent(redirectTo)))
  const c = await createRequestContainer()
  const auth = c.resolve<AuthService>('authService')
  const ctx = await auth.refreshFromSessionToken(token)
  if (!ctx) return NextResponse.redirect(toAbs('/login?redirect=' + encodeURIComponent(redirectTo)))
  const { user, roles } = ctx
  const jwt = signJwt({ sub: String(user.id), tenantId: String(user.tenantId), orgId: String(user.organizationId), email: user.email, roles })
  const res = NextResponse.redirect(toAbs(redirectTo))
  res.cookies.set('auth_token', jwt, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8 })
  return res
}

export const metadata = {
  GET: { requireAuth: false },
}

const refreshQuerySchema = z.object({
  redirect: z.string().optional().describe('Absolute or relative URL to redirect after refresh'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Refresh session token',
  methods: {
    GET: {
      summary: 'Refresh auth cookie from session token',
      description: 'Exchanges an existing `session_token` cookie for a fresh JWT auth cookie and redirects the browser.',
      query: refreshQuerySchema,
      responses: [
        { status: 302, description: 'Redirect to target location when session is valid', mediaType: 'text/html' },
      ],
    },
  },
}
