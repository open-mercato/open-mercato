import { requestPasswordResetSchema } from '@mercato-core/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { AuthService } from '@mercato-core/modules/auth/services/authService'
import { sendEmail } from '@/lib/email/send'
import ResetPasswordEmail from '@mercato-core/modules/auth/emails/ResetPasswordEmail'

// validation via requestPasswordResetSchema

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const parsed = requestPasswordResetSchema.safeParse({ email })
  if (!parsed.success) return NextResponse.json({ ok: true }) // do not reveal
  const c = await createRequestContainer()
  const auth = c.resolve<AuthService>('authService')
  const resReq = await auth.requestPasswordReset(parsed.data.email)
  if (!resReq) return NextResponse.json({ ok: true })
  const { user, token } = resReq
  const url = new URL(req.url)
  const base = process.env.APP_URL || `${url.protocol}//${url.host}`
  const resetUrl = `${base}/reset/${token}`
  await sendEmail({ to: user.email, subject: 'Reset your password', react: ResetPasswordEmail({ resetUrl }) })
  return NextResponse.json({ ok: true })
}
