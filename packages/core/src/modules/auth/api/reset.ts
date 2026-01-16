import { requestPasswordResetSchema } from '@open-mercato/core/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import ResetPasswordEmail from '@open-mercato/core/modules/auth/emails/ResetPasswordEmail'
import { z } from 'zod'

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

export const metadata = {
  POST: {},
}

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
})

const passwordResetResponseSchema = z.object({
  ok: z.literal(true),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Request password reset',
  methods: {
    POST: {
      summary: 'Send reset email',
      description: 'Requests a password reset email for the given account. The endpoint always returns `ok: true` to avoid leaking account existence.',
      requestBody: {
        contentType: 'application/x-www-form-urlencoded',
        schema: passwordResetRequestSchema,
      },
      responses: [
        { status: 200, description: 'Reset email dispatched (or ignored for unknown accounts)', schema: passwordResetResponseSchema },
      ],
    },
  },
}
