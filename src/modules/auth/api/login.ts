import { NextResponse } from 'next/server'
import { z } from 'zod'
import { compare } from 'bcryptjs'
import { getDb } from '@/db'
import { users, roles, userRoles, authSessions } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { signJwt } from '@/lib/auth/jwt'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) })

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const remember = String(form.get('remember') ?? '').toLowerCase() === 'on' || String(form.get('remember') ?? '') === '1' || String(form.get('remember') ?? '') === 'true'
  const requireRoleRaw = (String(form.get('requireRole') ?? form.get('role') ?? '')).trim()
  const requiredRoles = requireRoleRaw ? requireRoleRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  const parsed = loginSchema.safeParse({ email, password })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 400 })
  }
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1)
  if (!user || !user.passwordHash) {
    return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 })
  }
  const ok = await compare(parsed.data.password, user.passwordHash)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 })
  }
  // Optional role requirement
  if (requiredRoles.length) {
    let authorized = false
    for (const roleName of requiredRoles) {
      const r = await db.select({ roleId: roles.id }).from(roles).where(eq(roles.name, roleName)).limit(1)
      const roleId = r[0]?.roleId
      if (!roleId) continue
      const rel = await db.select().from(userRoles).where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, roleId))).limit(1)
      if (rel.length) { authorized = true; break }
    }
    if (!authorized) {
      return NextResponse.json({ ok: false, error: 'Not authorized for this area' }, { status: 403 })
    }
  }
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
  // Embed roles in token
  const userRoleNames: string[] = []
  const roleRows = await db.select({ id: roles.id, name: roles.name }).from(roles)
  const assigned = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.id))
  const assignedSet = new Set(assigned.map(r => r.roleId))
  for (const r of roleRows) {
    if (assignedSet.has(r.id)) userRoleNames.push(r.name)
  }
  const token = signJwt({ sub: user.id, orgId: user.organizationId, email: user.email, roles: userRoleNames })
  const res = NextResponse.json({ ok: true, token, redirect: '/backend' })
  res.cookies.set('auth_token', token, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8 })
  if (remember) {
    const days = Number(process.env.REMEMBER_ME_DAYS || '30')
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const crypto = await import('node:crypto')
    const sessionToken = crypto.randomBytes(32).toString('hex')
    await db.insert(authSessions).values({ userId: user.id, token: sessionToken, expiresAt })
    res.cookies.set('session_token', sessionToken, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt })
  }
  return res
}
