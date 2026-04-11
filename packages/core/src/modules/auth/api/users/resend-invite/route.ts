import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { User, PasswordReset } from '@open-mercato/core/modules/auth/data/entities'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import InviteUserEmail from '@open-mercato/core/modules/auth/emails/InviteUserEmail'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { INVITE_TOKEN_TTL_MS, resolveInviteBaseUrl } from '@open-mercato/core/modules/auth/lib/inviteToken'
import type { EntityManager } from '@mikro-orm/postgresql'
import crypto from 'node:crypto'
import { hashOpaqueToken } from '@open-mercato/shared/lib/security/token'

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

const validationErrorSchema = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
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

  let isSuperAdmin = false
  try {
    if (auth.sub) {
      const rbacService = container.resolve('rbacService') as {
        loadAcl: (userId: string, scope: { tenantId: string | null; organizationId: string | null }) => Promise<{ isSuperAdmin?: boolean } | null>
      }
      const acl = await rbacService.loadAcl(auth.sub, {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      })
      isSuperAdmin = !!acl?.isSuperAdmin
    }
  } catch (err) {
    console.error('[auth.users.resend-invite] Failed to resolve rbac:', err)
  }

  const where: Record<string, unknown> = { id: parsed.data.id, deletedAt: null }
  if (!isSuperAdmin) {
    if (!auth.tenantId) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    where.tenantId = auth.tenantId
  }

  const user = await em.findOne(User, where as any)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (user.passwordHash) {
    return NextResponse.json({ error: 'User already has a password' }, { status: 409 })
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: user.tenantId ? String(user.tenantId) : auth.tenantId ?? '',
    organizationId: user.organizationId ? String(user.organizationId) : null,
    userId: auth.sub ?? '',
    resourceKind: 'auth.user',
    resourceId: String(user.id),
    operation: 'custom',
    requestMethod: 'POST',
    requestHeaders: req.headers,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  await em.nativeUpdate(
    PasswordReset,
    { user: user.id, usedAt: null } as any,
    { usedAt: new Date() },
  )

  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashOpaqueToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS)
  const row = em.create(PasswordReset, { user, token: tokenHash, tokenHash, expiresAt, createdAt: new Date() })
  await em.persistAndFlush(row)

  const base = resolveInviteBaseUrl(req.url)
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

  if (guardResult?.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: user.tenantId ? String(user.tenantId) : auth.tenantId ?? '',
      organizationId: user.organizationId ? String(user.organizationId) : null,
      userId: auth.sub ?? '',
      resourceKind: 'auth.user',
      resourceId: String(user.id),
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: req.headers,
      metadata: guardResult.metadata,
    })
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
      description: 'Resends the invitation email to a user who has not yet set up their password. Generates a new 48-hour setup token and invalidates prior tokens.',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [
        { status: 200, description: 'Invite email sent', schema: responseSchema },
      ],
      errors: [
        { status: 404, description: 'User not found', schema: errorSchema },
        { status: 409, description: 'User already has a password', schema: errorSchema },
        { status: 422, description: 'Validation error', schema: validationErrorSchema },
        { status: 429, description: 'Rate limit exceeded', schema: rateLimitErrorSchema },
      ],
    },
  },
}
