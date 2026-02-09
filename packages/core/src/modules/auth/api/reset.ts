import { requestPasswordResetSchema } from '@open-mercato/core/modules/auth/data/validators'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import ResetPasswordEmail from '@open-mercato/core/modules/auth/emails/ResetPasswordEmail'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import notificationTypes from '@open-mercato/core/modules/auth/notifications'
import { z } from 'zod'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'

const resetRateLimitConfig = readEndpointRateLimitConfig('RESET', {
  points: 3, duration: 60, blockDuration: 60, keyPrefix: 'reset',
})

// validation via requestPasswordResetSchema

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  // Rate limit by IP + email — checked before validation and DB work
  try {
    const rateLimiterService = getCachedRateLimiterService()
    if (rateLimiterService) {
      const clientIp = getClientIp(req)
      const compoundKey = `${clientIp}:${email.toLowerCase()}`
      const { translate } = await resolveTranslations()
      const rateLimitError = await checkRateLimit(
        rateLimiterService,
        resetRateLimitConfig,
        compoundKey,
        translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
      )
      if (rateLimitError) return rateLimitError
    }
  } catch {
    // fail-open
  }
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

  const { translate } = await resolveTranslations()
  const subject = translate('auth.email.resetPassword.subject', 'Reset your password')
  const copy = {
    preview: translate('auth.email.resetPassword.preview', 'Reset your password'),
    title: translate('auth.email.resetPassword.title', 'Reset your password'),
    body: translate('auth.email.resetPassword.body', 'Click the link below to set a new password. This link will expire in 60 minutes.'),
    cta: translate('auth.email.resetPassword.cta', 'Set a new password'),
    hint: translate('auth.email.resetPassword.hint', "If you didn't request this, you can safely ignore this email."),
  }

  await sendEmail({ to: user.email, subject, react: ResetPasswordEmail({ resetUrl, copy }) })
  try {
    const tenantId = user.tenantId ? String(user.tenantId) : null
    if (tenantId) {
      const notificationService = resolveNotificationService(c)
      const typeDef = notificationTypes.find((type) => type.type === 'auth.password_reset.requested')
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
    console.error('[auth.reset] Failed to create notification:', err)
  }
  return NextResponse.json({ ok: true })
}

export const metadata = {}

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
})

const passwordResetResponseSchema = z.object({
  ok: z.literal(true),
})

const rateLimitErrorSchema = z.object({
  error: z.string().describe('Rate limit exceeded message'),
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
      errors: [
        { status: 429, description: 'Too many password reset requests', schema: rateLimitErrorSchema },
      ],
    },
  },
}
