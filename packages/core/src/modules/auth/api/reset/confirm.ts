import { confirmPasswordResetSchema } from '@open-mercato/core/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { z } from 'zod'

// validation via confirmPasswordResetSchema

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

export const metadata = {
  POST: {},
}

const passwordResetConfirmResponseSchema = z.object({
  ok: z.literal(true),
  redirect: z.string(),
})

const passwordResetErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Confirm password reset',
  methods: {
    POST: {
      summary: 'Complete password reset',
      description: 'Validates the reset token and updates the user password.',
      requestBody: {
        contentType: 'application/x-www-form-urlencoded',
        schema: confirmPasswordResetSchema,
      },
      responses: [
        { status: 200, description: 'Password reset succeeded', schema: passwordResetConfirmResponseSchema },
        { status: 400, description: 'Invalid token or payload', schema: passwordResetErrorSchema },
      ],
    },
  },
}
