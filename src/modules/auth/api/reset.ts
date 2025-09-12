import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getEm } from '@/lib/db/mikro'
import { requestPasswordReset } from '@/modules/auth/services/authService'
import crypto from 'node:crypto'
import { sendEmail } from '@/lib/email/send'
import ResetPasswordEmail from '@/emails/ResetPasswordEmail'

const schema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const parsed = schema.safeParse({ email })
  if (!parsed.success) return NextResponse.json({ ok: true }) // do not reveal
  const em = await getEm()
  const resReq = await requestPasswordReset(em as any, parsed.data.email)
  if (!resReq) return NextResponse.json({ ok: true })
  const { user, token } = resReq
  const url = new URL(req.url)
  const base = process.env.APP_URL || `${url.protocol}//${url.host}`
  const resetUrl = `${base}/reset/${token}`
  await sendEmail({ to: user.email, subject: 'Reset your password', react: ResetPasswordEmail({ resetUrl }) })
  return NextResponse.json({ ok: true })
}
