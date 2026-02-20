import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { userLoginSchema } from '@open-mercato/core/modules/auth/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EventBus } from '@open-mercato/events/types'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { emitAuthEvent } from '@open-mercato/core/modules/auth/events'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkAuthRateLimit, resetAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'

const loginRateLimitConfig = readEndpointRateLimitConfig('LOGIN', {
  points: 5, duration: 60, blockDuration: 60, keyPrefix: 'login',
})
const loginIpRateLimitConfig = readEndpointRateLimitConfig('LOGIN_IP', {
  points: 20, duration: 60, blockDuration: 60, keyPrefix: 'login-ip',
})

export const metadata = {}

// validation comes from userLoginSchema

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const remember = parseBooleanToken(form.get('remember')?.toString()) === true
  const tenantIdRaw = String(form.get('tenantId') ?? form.get('tenant') ?? '').trim()
  const requireRoleRaw = (String(form.get('requireRole') ?? form.get('role') ?? '')).trim()
  const requiredRoles = requireRoleRaw ? requireRoleRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  // Rate limit — two layers, both checked before validation and DB work
  const { error: rateLimitError, compoundKey: rateLimitCompoundKey } = await checkAuthRateLimit({
    req, ipConfig: loginIpRateLimitConfig, compoundConfig: loginRateLimitConfig, compoundIdentifier: email,
  })
  if (rateLimitError) return rateLimitError
  const parsed = userLoginSchema.pick({ email: true, password: true, tenantId: true }).safeParse({
    email,
    password,
    tenantId: tenantIdRaw || undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: translate('auth.login.errors.invalidCredentials', 'Invalid credentials') }, { status: 400 })
  }
  const container = await createRequestContainer()
  const auth = (container.resolve('authService') as AuthService)
  const tenantId = parsed.data.tenantId ?? null
  let user = null
  if (tenantId) {
    user = await auth.findUserByEmailAndTenant(parsed.data.email, tenantId)
  } else {
    const users = await auth.findUsersByEmail(parsed.data.email)
    if (users.length > 1) {
      return NextResponse.json({
        ok: false,
        error: translate('auth.login.errors.tenantRequired', 'Use the login link provided with your tenant activation to continue.'),
      }, { status: 400 })
    }
    user = users[0] ?? null
  }
  if (!user || !user.passwordHash) {
    void emitAuthEvent('auth.login.failed', { email: parsed.data.email, reason: 'invalid_credentials' }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: translate('auth.login.errors.invalidCredentials', 'Invalid email or password') }, { status: 401 })
  }
  const ok = await auth.verifyPassword(user, parsed.data.password)
  if (!ok) {
    void emitAuthEvent('auth.login.failed', { email: parsed.data.email, reason: 'invalid_password' }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: translate('auth.login.errors.invalidCredentials', 'Invalid email or password') }, { status: 401 })
  }
  // Optional role requirement
  if (requiredRoles.length) {
    const userRoleNames = await auth.getUserRoles(user, tenantId ?? (user.tenantId ? String(user.tenantId) : null))
    const authorized = requiredRoles.some(r => userRoleNames.includes(r))
    if (!authorized) {
      return NextResponse.json({ ok: false, error: translate('auth.login.errors.permissionDenied', 'Not authorized for this area') }, { status: 403 })
    }
  }
  await auth.updateLastLoginAt(user)
  // Reset rate limit counter on successful login so legitimate users aren't penalized for prior typos
  if (rateLimitCompoundKey) {
    await resetAuthRateLimit(rateLimitCompoundKey, loginRateLimitConfig)
  }
  const resolvedTenantId = tenantId ?? (user.tenantId ? String(user.tenantId) : null)
  const userRoleNames = await auth.getUserRoles(user, resolvedTenantId)
  try {
    const eventBus = (container.resolve('eventBus') as EventBus)
    void eventBus.emitEvent('query_index.coverage.warmup', {
      tenantId: resolvedTenantId,
    }).catch(() => undefined)
  } catch {
    // optional warmup
  }
  const token = signJwt({
    sub: String(user.id),
    tenantId: resolvedTenantId,
    orgId: user.organizationId ? String(user.organizationId) : null,
    email: user.email,
    roles: userRoleNames
  })
  void emitAuthEvent('auth.login.success', { id: String(user.id), email: user.email, tenantId: resolvedTenantId, organizationId: user.organizationId ? String(user.organizationId) : null }).catch(() => undefined)
  const res = NextResponse.json({ ok: true, token, redirect: '/backend' })
  res.cookies.set('auth_token', token, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 8 })
  if (remember) {
    const days = Number(process.env.REMEMBER_ME_DAYS || '30')
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    const sess = await auth.createSession(user, expiresAt)
    res.cookies.set('session_token', sess.token, { httpOnly: true, path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt })
  }
  return res
}

const loginRequestSchema = userLoginSchema.extend({
  password: z.string().min(6).describe('User password'),
  remember: z.enum(['on', '1', 'true']).optional().describe('Persist the session (submit `on`, `1`, or `true`).'),
}).describe('Login form payload')

const loginSuccessSchema = z.object({
  ok: z.literal(true),
  token: z.string().describe('JWT token issued for subsequent API calls'),
  redirect: z.string().nullable().describe('Next location the client should navigate to'),
})

const loginErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const loginMethodDoc: OpenApiMethodDoc = {
  summary: 'Authenticate user credentials',
  description: 'Validates the submitted credentials and issues a bearer token cookie for subsequent API calls.',
  tags: ['Authentication & Accounts'],
  requestBody: {
    contentType: 'application/x-www-form-urlencoded',
    schema: loginRequestSchema,
    description: 'Form-encoded payload captured from the login form.',
  },
  responses: [
    {
      status: 200,
      description: 'Authentication succeeded',
      schema: loginSuccessSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: loginErrorSchema },
    { status: 401, description: 'Invalid credentials', schema: loginErrorSchema },
    { status: 403, description: 'User lacks required role', schema: loginErrorSchema },
    { status: 429, description: 'Too many login attempts', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Authenticate user credentials',
  description: 'Accepts login form submissions and manages cookie/session issuance.',
  methods: {
    POST: loginMethodDoc,
  },
}
