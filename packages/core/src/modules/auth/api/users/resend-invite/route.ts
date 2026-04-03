import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { User, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import InviteUserEmail from '@open-mercato/core/modules/auth/emails/InviteUserEmail'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import notificationTypes from '@open-mercato/core/modules/auth/notifications'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'
import type { EntityManager } from '@mikro-orm/postgresql'
import crypto from 'node:crypto'

const resendInviteRateLimitConfig = readEndpointRateLimitConfig('RESEND_INVITE', {
  points: 3, duration: 300, blockDuration: 300, keyPrefix: 'resend-invite',
})

const requestSchema = z.object({
  id: z.string().uuid(),
})

const responseSchema = z.object({
  ok: z.literal(true),
})

const errorSchema = z.object({
  error: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['auth.users.create'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: resendInviteRateLimitConfig,
  })
  if (rateLimitError) return rateLimitError

  const body = await readJsonSafe(req, {})
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const user = await em.findOne(User, { id: parsed.data.id, deletedAt: null })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
  const row = em.create(PasswordReset as any, { user, token, expiresAt, createdAt: new Date() } as any)
  await em.persistAndFlush(row)

  const url = new URL(req.url)
  const base = process.env.APP_URL || `${url.protocol}//${url.host}`
  const inviteUrl = `${base}/reset/${token}`

  const { translate } = await resolveTranslations()
  const subject = translate('auth.email.invite.subject', 'You have been invited')
  const copy = {
    preview: translate('auth.email.invite.preview', 'Set up your account'),
    title: translate('auth.email.invite.title', 'You have been invited'),
    body: translate('auth.email.invite.body', 'An administrator has created an account for you. Click the link below to set your password. This link will expire in 48 hours.'),
    cta: translate('auth.email.invite.cta', 'Set up your password'),
    hint: translate('auth.email.invite.hint', 'If you did not expect this invitation, you can safely ignore this email.'),
  }

  let emailSent = true
  try {
    await sendEmail({ to: user.email, subject, react: InviteUserEmail({ inviteUrl, copy }) })
  } catch (err) {
    console.error('[auth.users.resend-invite] Failed to send invitation email:', err)
    emailSent = false
  }

  try {
    const tenantId = user.tenantId ? String(user.tenantId) : null
    if (tenantId) {
      const notificationService = resolveNotificationService(container)
      const typeDef = notificationTypes.find((type) => type.type === 'auth.user.invited')
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
    console.error('[auth.users.resend-invite] Failed to create notification:', err)
  }

  if (!emailSent) {
    return NextResponse.json({ ok: true, warning: 'invite_email_failed' })
  }

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Resend user invite',
  methods: {
    POST: {
      summary: 'Resend invitation email',
      description: 'Resends the invitation email to a user who has not yet set up their password. Generates a new 48-hour setup token.',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [
        { status: 200, description: 'Invite email sent', schema: responseSchema },
      ],
      errors: [
        { status: 404, description: 'User not found', schema: errorSchema },
        { status: 422, description: 'Validation error', schema: errorSchema },
        { status: 429, description: 'Rate limit exceeded', schema: rateLimitErrorSchema },
      ],
    },
  },
}
