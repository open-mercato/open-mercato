import { NextResponse } from 'next/server'
import { getEm } from '@/lib/db/mikro'
import { deleteSessionByToken } from '@/modules/auth/services/authService'

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

export async function POST(req: Request) {
  const sessToken = parseCookie(req, 'session_token')
  if (sessToken) {
    try { const em = await getEm(); await deleteSessionByToken(em as any, sessToken) } catch {}
  }
  const res = NextResponse.redirect('/login')
  res.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  res.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  return POST(req)
}
