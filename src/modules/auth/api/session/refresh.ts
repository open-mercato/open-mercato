import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { authSessions, users, roles, userRoles } from '@/db/schema'
import { and, eq, gt } from 'drizzle-orm'
import { signJwt } from '@/lib/auth/jwt'

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
  const db = getDb()
  const now = new Date()
  const [sess] = await db.select().from(authSessions).where(and(eq(authSessions.token, token), gt(authSessions.expiresAt, now))).limit(1)
  if (!sess) return NextResponse.redirect(toAbs('/login?redirect=' + encodeURIComponent(redirectTo)))
  // Load user and roles
  const [user] = await db.select().from(users).where(eq(users.id, sess.userId)).limit(1)
  if (!user) return NextResponse.redirect(toAbs('/login?redirect=' + encodeURIComponent(redirectTo)))
  const assigned = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.id))
  const assignedSet = new Set(assigned.map(r => r.roleId))
  const roleRows = await db.select({ id: roles.id, name: roles.name }).from(roles)
  const userRoleNames: string[] = []
  for (const r of roleRows) if (assignedSet.has(r.id)) userRoleNames.push(r.name)
  const jwt = signJwt({ sub: user.id, orgId: user.organizationId, email: user.email, roles: userRoleNames })
  const res = NextResponse.redirect(toAbs(redirectTo))
  res.cookies.set('auth_token', jwt, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8 })
  return res
}
