import { NextResponse } from 'next/server'
import { z } from 'zod'
import { compare } from 'bcryptjs'
import { getDb } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { signJwt } from '@/lib/auth/jwt'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) })

export default async function loginHandler(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
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
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))
  const token = signJwt({ sub: user.id, orgId: user.organizationId, email: user.email })
  const res = NextResponse.json({ ok: true, token, redirect: '/backend' })
  res.cookies.set('auth_token', token, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8 })
  return res
}
