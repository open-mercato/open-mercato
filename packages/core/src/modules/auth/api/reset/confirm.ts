import { confirmPasswordResetSchema } from '@open-mercato/core/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import notificationTypes from '@open-mercato/core/modules/auth/notifications'
import { z } from 'zod'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'

const resetConfirmRateLimitConfig = readEndpointRateLimitConfig('RESET_CONFIRM', {
  points: 5, duration: 300, keyPrefix: 'reset-confirm',
})

// validation via confirmPasswordResetSchema

export async function POST(req: Request) {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const password = String(form.get('password') ?? '')
  // Rate limit by IP — checked before validation and DB work
  const { error: rateLimitError } = await checkAuthRateLimit({ req, ipConfig: resetConfirmRateLimitConfig })
  if (rateLimitError) return rateLimitError
  const parsed = confirmPasswordResetSchema.safeParse({ token, password })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  const c = await createRequestContainer()
  const auth = c.resolve<AuthService>('authService')
  const user = await auth.confirmPasswordReset(parsed.data.token, parsed.data.password)
  if (!user) return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  try {
    const tenantId = user.tenantId ? String(user.tenantId) : null
    if (tenantId) {
      const notificationService = resolveNotificationService(c)
      const typeDef = notificationTypes.find((type) => type.type === 'auth.password_reset.completed')
      if (typeDef) {
        const notificationInput = buildNotificationFromType(typeDef, {
          recipientUserId: String(user.id),
          sourceEntityType: 'auth:user',
          sourceEntityId: String(user.id),
        })
        await notificationService.create(notificationInput, {
          tenantId,
          organizationId: user.organizationId ? String(user.organizationId) : null,
        })
      }
    }
  } catch (err) {
    console.error('[auth.reset.confirm] Failed to create notification:', err)
  }
  return NextResponse.json({ ok: true, redirect: '/login' })
}

export const metadata = {}

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
      errors: [
        { status: 429, description: 'Too many reset confirmation attempts', schema: rateLimitErrorSchema },
      ],
    },
  },
}
