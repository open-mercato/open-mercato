import { confirmPasswordResetSchema } from '@/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { AuthService } from '@/modules/auth/services/authService'
import { hash } from 'bcryptjs'

const schema = z.object({ token: z.string().min(10), password: z.string().min(6) })

export async function POST(req: Request) {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const password = String(form.get('password') ?? '')
  const parsed = confirmPasswordResetSchema.safeParse({ token, password })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  const c = await createRequestContainer()
  const auth = c.resolve<AuthService>('authService')
  const ok = await auth.confirmPasswordReset(parsed.data.token, parsed.data.password)
  if (!ok) return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  return NextResponse.json({ ok: true, redirect: '/login' })
}
