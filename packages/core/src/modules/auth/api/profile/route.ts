import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'

const profileResponseSchema = z.object({
  email: z.string().email(),
  roles: z.array(z.string()),
})

const passwordSchema = buildPasswordSchema()

const updateSchemaBase = z.object({
  email: z.string().email().optional(),
  currentPassword: z.string().trim().min(1).optional(),
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
    if (data.currentPassword && !data.password) {
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
    const user = await findOneWithDecryption(
      em,
      User,
      { id: auth.sub, deletedAt: null },
      undefined,
      { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
    )
    if (!user) {
      return NextResponse.json({ error: translate('auth.users.form.errors.notFound', 'User not found') }, { status: 404 })
    }
    return NextResponse.json({ email: String(user.email), roles: auth.roles ?? [] })
  } catch (err) {
    console.error('auth.profile.load failed', err)
    return NextResponse.json({ error: translate('auth.profile.form.errors.load', 'Failed to load profile.') }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: translate('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
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
    if (parsed.data.password) {
      const user = await findOneWithDecryption(
        em,
        User,
        { id: auth.sub, deletedAt: null },
        undefined,
        { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
      )
      if (!user) {
        return NextResponse.json({ error: translate('auth.users.form.errors.notFound', 'User not found') }, { status: 404 })
      }
      const currentPassword = parsed.data.currentPassword?.trim() ?? ''
      const isCurrentPasswordValid = await authService.verifyPassword(user, currentPassword)
      if (!isCurrentPasswordValid) {
        const message = translate(
          'auth.profile.form.errors.currentPasswordInvalid',
          'Current password is incorrect.',
        )
        return NextResponse.json(
          {
            error: message,
            issues: [{ path: ['currentPassword'], message }],
          },
          { status: 400 },
        )
      }
    }
    const commandBus = (container.resolve('commandBus') as CommandBus)
    const ctx = buildCommandContext(container, auth, req)
    const { result } = await commandBus.execute<{ id: string; email?: string; password?: string }, User>(
      'auth.users.update',
      {
        input: {
          id: auth.sub,
          email: parsed.data.email,
          password: parsed.data.password,
        },
        ctx,
      },
    )
    const roles = await authService.getUserRoles(result, result.tenantId ? String(result.tenantId) : null)
    const jwt = signJwt({
      sub: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      orgId: result.organizationId ? String(result.organizationId) : null,
      email: result.email,
      roles,
    })
    const res = NextResponse.json({ ok: true, email: String(result.email) })
    res.cookies.set('auth_token', jwt, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
    })
    return res
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('auth.profile.update failed', err)
    return NextResponse.json({ error: translate('auth.profile.form.errors.save', 'Failed to update profile.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Profile settings',
  methods: {
    GET: {
      summary: 'Get current profile',
      description: 'Returns the email address for the signed-in user.',
      responses: [
        { status: 200, description: 'Profile payload', schema: profileResponseSchema },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'User not found', schema: z.object({ error: z.string() }) },
      ],
    },
    PUT: {
      summary: 'Update current profile',
      description: 'Updates the email address or password for the signed-in user.',
      requestBody: {
        contentType: 'application/json',
        schema: updateSchema,
      },
      responses: [
        { status: 200, description: 'Profile updated', schema: profileUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
