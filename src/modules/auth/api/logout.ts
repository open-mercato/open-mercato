import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { authSessions } from '@/db/schema'
import { eq } from 'drizzle-orm'

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

export async function POST(req: Request) {
  const db = getDb()
  const sessToken = parseCookie(req, 'session_token')
  if (sessToken) {
    try { await db.delete(authSessions).where(eq(authSessions.token, sessToken)) } catch {}
  }
  const res = NextResponse.redirect('/login')
  res.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  res.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  return POST(req)
}

