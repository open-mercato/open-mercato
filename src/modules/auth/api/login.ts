import { NextResponse } from 'next/server'
import { userLoginSchema } from '@/modules/auth/data/validators'
import { compare } from 'bcryptjs'
import { createRequestContainer } from '@/lib/di/container'
import { AuthService } from '@/modules/auth/services/authService'
import { signJwt } from '@/lib/auth/jwt'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) })

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const remember = String(form.get('remember') ?? '').toLowerCase() === 'on' || String(form.get('remember') ?? '') === '1' || String(form.get('remember') ?? '') === 'true'
  const requireRoleRaw = (String(form.get('requireRole') ?? form.get('role') ?? '')).trim()
  const requiredRoles = requireRoleRaw ? requireRoleRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  const parsed = userLoginSchema.pick({ email: true, password: true }).safeParse({ email, password })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const auth = container.resolve<AuthService>('authService')
  const user = await auth.findUserByEmail(parsed.data.email)
  if (!user || !user.passwordHash) {
    return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 })
  }
  const ok = await auth.verifyPassword(user, parsed.data.password)
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 })
  }
  // Optional role requirement
  if (requiredRoles.length) {
    const userRoleNames = await auth.getUserRoles(user)
    const authorized = requiredRoles.some(r => userRoleNames.includes(r))
    if (!authorized) {
      return NextResponse.json({ ok: false, error: 'Not authorized for this area' }, { status: 403 })
    }
  }
  await auth.updateLastLoginAt(user)
  const userRoleNames = await auth.getUserRoles(user)
  const token = signJwt({ sub: String(user.id), tenantId: String(user.tenant.id), orgId: String(user.organization.id), email: user.email, roles: userRoleNames })
  const res = NextResponse.json({ ok: true, token, redirect: '/backend' })
  res.cookies.set('auth_token', token, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8 })
  if (remember) {
    const days = Number(process.env.REMEMBER_ME_DAYS || '30')
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const sess = await auth.createSession(user, expiresAt)
    res.cookies.set('session_token', sess.token, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt })
  }
  return res
}
