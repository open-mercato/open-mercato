import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

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
  const url = new URL(req.url)
  const toAbs = (p: string) => new URL(p, url.origin).toString()
  const res = NextResponse.redirect(toAbs('/login'))
  res.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  res.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  return POST(req)
}
