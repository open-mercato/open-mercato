import { validatePasswordResetTokenSchema } from '@open-mercato/core/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { z } from 'zod'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'

const resetValidateRateLimitConfig = readEndpointRateLimitConfig('RESET_VALIDATE', {
  points: 10, duration: 300, keyPrefix: 'reset-validate',
})

// validation via validatePasswordResetTokenSchema

export async function POST(req: Request) {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  // Rate limit by IP — checked before validation and DB work
  const { error: rateLimitError } = await checkAuthRateLimit({ req, ipConfig: resetValidateRateLimitConfig })
  if (rateLimitError) return rateLimitError
  const parsed = validatePasswordResetTokenSchema.safeParse({ token })
  // A malformed token is reported as simply not valid: the caller learns nothing
  // it could not learn by posting the same token to /api/auth/reset/confirm.
  if (!parsed.success) return NextResponse.json({ ok: true, valid: false })
  const c = await createRequestContainer()
  const auth = c.resolve<AuthService>('authService')
  const valid = await auth.isPasswordResetTokenValid(parsed.data.token)
  return NextResponse.json({ ok: true, valid })
}

export const metadata = { requireAuth: false }

const passwordResetValidateResponseSchema = z.object({
  ok: z.literal(true),
  valid: z.boolean(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Check a password reset token',
  methods: {
    POST: {
      summary: 'Check whether a password reset token is still usable',
      description: 'Reports whether a reset token exists, is unused, and has not expired, so the reset page can render a terminal state instead of a form the token can never submit. The token is never consumed and the response never distinguishes unknown, used, and expired tokens.',
      requestBody: {
        contentType: 'application/x-www-form-urlencoded',
        schema: validatePasswordResetTokenSchema,
      },
      responses: [
        { status: 200, description: 'Token state resolved', schema: passwordResetValidateResponseSchema },
      ],
      errors: [
        { status: 429, description: 'Too many token validation attempts', schema: rateLimitErrorSchema },
      ],
    },
  },
}
