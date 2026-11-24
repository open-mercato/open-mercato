import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { resolveUserDataSubject } from '@open-mercato/core/modules/auth/lib/userDataSubject'
import { PROFILE_PASSWORD_PROOF, type ProfilePasswordProof } from '@open-mercato/core/modules/auth/lib/profilePasswordProof'
import { isCrossSiteBrowserRequest } from '@open-mercato/shared/lib/url'

const logger = createLogger('auth').child({ component: 'profile' })

const profileResponseSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable().optional(),
  roles: z.array(z.string()),
})

const passwordSchema = buildPasswordSchema()

const updateSchemaBase = z.object({
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).optional(),
  password: passwordSchema.optional(),
})

function buildUpdateSchema(translate: (key: string, fallback: string) => string) {
  return updateSchemaBase.superRefine((data, ctx) => {
    if (!data.email && !data.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: translate(
          'auth.profile.form.errors.emailOrPasswordRequired',
          'Provide an email or password.',
        ),
        path: ['email'],
      })
    }
    if (data.password && !data.currentPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: translate(
          'auth.profile.form.errors.currentPasswordRequired',
          'Current password is required.',
        ),
        path: ['currentPassword'],
      })
    }
    if (data.currentPassword && !data.password && !data.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: translate(
          'auth.profile.form.errors.newPasswordRequired',
          'New password is required.',
        ),
        path: ['password'],
      })
    }
  })
}

const updateSchema = buildUpdateSchema((_key, fallback) => fallback)

const profileUpdateResponseSchema = z.object({
  ok: z.literal(true),
  email: z.string().email(),
})

export const metadata = {
  GET: { requireAuth: true },
  PUT: { requireAuth: true },
}

function buildCommandContext(container: Awaited<ReturnType<typeof createRequestContainer>>, auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>, req: Request): CommandRuntimeContext {
  return {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: auth.orgId ?? null,
    organizationIds: auth.orgId ? [auth.orgId] : null,
    request: req,
  }
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  try {
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    const userId = await resolveUserDataSubject(em, auth)
    if (!userId) {
      return NextResponse.json({ error: translate('api.errors.forbidden', 'Forbidden') }, { status: 403 })
    }
    const user = await findOneWithDecryption(
      em,
      User,
      {
        id: userId,
        deletedAt: null,
        ...(auth.isApiKey ? { tenantId: auth.tenantId, ...(auth.orgId ? { organizationId: auth.orgId } : {}) } : {}),
      },
      undefined,
      { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
    )
    if (!user) {
      return NextResponse.json({ error: translate('auth.users.form.errors.notFound', 'User not found') }, { status: 404 })
    }
    const displayName = typeof user.name === 'string' ? user.name.trim() : ''
    return NextResponse.json({
      email: String(user.email),
      name: displayName.length > 0 ? displayName : null,
      roles: auth.roles ?? [],
    })
  } catch (err) {
    logger.error('Profile load failed', { err })
    return NextResponse.json({ error: translate('auth.profile.form.errors.load', 'Failed to load profile.') }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  if (auth.isApiKey || isCrossSiteBrowserRequest(req)) {
    return NextResponse.json({ error: translate('api.errors.forbidden', 'Forbidden') }, { status: 403 })
  }
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = buildUpdateSchema(translate).safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: translate('auth.profile.form.errors.invalid', 'Invalid profile update.'),
          issues: parsed.error.issues,
        },
        { status: 400 },
      )
    }
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager)
    const authService = container.resolve('authService') as AuthService
    const actorTenantId = typeof auth.actorTenantId === 'string' ? auth.actorTenantId : auth.tenantId
    const actorOrganizationId = typeof auth.actorOrgId === 'string' ? auth.actorOrgId : auth.orgId
    const user = await findOneWithDecryption(
      em,
      User,
      { id: auth.sub, deletedAt: null },
      undefined,
      { tenantId: actorTenantId ?? null, organizationId: actorOrganizationId ?? null },
    )
    if (!user) {
      return NextResponse.json({ error: translate('auth.users.form.errors.notFound', 'User not found') }, { status: 404 })
    }
    const emailChanged = parsed.data.email !== undefined && parsed.data.email !== user.email
    const ctx: CommandRuntimeContext & { [PROFILE_PASSWORD_PROOF]?: ProfilePasswordProof } =
      buildCommandContext(container, auth, req)
    if (parsed.data.password || emailChanged) {
      const currentPassword = parsed.data.currentPassword ?? ''
      const verified = currentPassword && await authService.verifyPassword(user, currentPassword)
      if (!verified || !user.passwordHash) {
        const message = currentPassword ? translate(
          'auth.profile.form.errors.currentPasswordInvalid',
          'Current password is incorrect.',
        ) : translate(
          'auth.profile.form.errors.currentPasswordRequired',
          'Current password is required.',
        )
        return NextResponse.json(
          {
            error: message,
            issues: [{ path: ['currentPassword'], message }],
          },
          { status: 400 },
        )
      }
      ctx[PROFILE_PASSWORD_PROOF] = { userId: auth.sub, passwordHash: user.passwordHash }
    } else {
      return NextResponse.json({ ok: true, email: user.email })
    }
    const commandBus = (container.resolve('commandBus') as CommandBus)
    const { result } = await commandBus.execute<{ id: string; email?: string; password?: string }, User>(
      'auth.users.update',
      {
        input: {
          id: auth.sub,
          email: emailChanged ? parsed.data.email : undefined,
          password: parsed.data.password,
        },
        ctx,
      },
    )
    const res = NextResponse.json({ ok: true, email: String(result.email) })
    for (const cookie of ['auth_token', 'session_token']) {
      res.cookies.set(cookie, '', {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 0,
      })
    }
    return res
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('Profile update failed', { err })
    return NextResponse.json({ error: translate('auth.profile.form.errors.save', 'Failed to update profile.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Profile settings',
  methods: {
    GET: {
      summary: 'Get current profile',
      description: 'Returns the email address, display name, and roles for the signed-in user. The display name is null when unset.',
      responses: [
        { status: 200, description: 'Profile payload', schema: profileResponseSchema },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'No user binding in the authenticated scope', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'User not found', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: 'Update current profile',
      description: 'Updates the sign-in email address or password after verification of the current password. A credential change ends existing sessions.',
      requestBody: {
        contentType: 'application/json',
        schema: updateSchema,
      },
      responses: [
        { status: 200, description: 'Profile updated', schema: profileUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Interactive session required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
