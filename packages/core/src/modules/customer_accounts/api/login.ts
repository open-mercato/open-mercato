import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { loginSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  resetAuthRateLimit,
  customerLoginRateLimitConfig,
  customerLoginIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 400 })
  }

  const { email, password, tenantId } = parsed.data
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'tenantId is required' }, { status: 400 })
  }

  const { error: rateLimitError, compoundKey } = await checkAuthRateLimit({
    req,
    ipConfig: customerLoginIpRateLimitConfig,
    compoundConfig: customerLoginRateLimitConfig,
    compoundIdentifier: email,
  })
  if (rateLimitError) return rateLimitError

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService

  const user = await customerUserService.findByEmail(email, tenantId)
  if (!user || !user.passwordHash) {
    void emitCustomerAccountsEvent('customer_accounts.login.failed', { email, reason: 'invalid_credentials', tenantId }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 })
  }

  if (!user.isActive) {
    return NextResponse.json({ ok: false, error: 'Account is deactivated' }, { status: 401 })
  }

  if (customerUserService.checkLockout(user)) {
    void emitCustomerAccountsEvent('customer_accounts.login.failed', { email, reason: 'locked', tenantId }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: 'Account is temporarily locked. Please try again later.' }, { status: 423 })
  }

  const passwordValid = await customerUserService.verifyPassword(user, password)
  if (!passwordValid) {
    await customerUserService.incrementFailedAttempts(user)
    void emitCustomerAccountsEvent('customer_accounts.login.failed', { email, reason: 'invalid_password', tenantId }).catch(() => undefined)
    return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 })
  }

  await customerUserService.resetFailedAttempts(user)
  await customerUserService.updateLastLoginAt(user)

  if (compoundKey) {
    await resetAuthRateLimit(compoundKey, customerLoginRateLimitConfig)
  }

  const acl = await customerRbacService.loadAcl(user.id, { tenantId, organizationId: user.organizationId })
  const resolvedFeatures = acl.features

  const ip = getClientIp(req, 0)
  const userAgent = req.headers.get('user-agent') || null
  const { rawToken, jwt, session } = await customerSessionService.createSession(user, resolvedFeatures, ip, userAgent)

  void emitCustomerAccountsEvent('customer_accounts.login.success', {
    id: user.id,
    email: user.email,
    tenantId,
    organizationId: user.organizationId,
  }).catch(() => undefined)

  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: !!user.emailVerifiedAt,
    },
    resolvedFeatures,
  })

  res.cookies.set('customer_auth_token', jwt, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  })
  res.cookies.set('customer_session_token', rawToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })

  return res
}

const loginSuccessSchema = z.object({
  ok: z.literal(true),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    emailVerified: z.boolean(),
  }),
  resolvedFeatures: z.array(z.string()),
})

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const methodDoc: OpenApiMethodDoc = {
  summary: 'Authenticate customer credentials',
  description: 'Validates customer credentials and issues JWT + session cookies.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: loginSchema,
    description: 'Login payload with email and password.',
  },
  responses: [
    { status: 200, description: 'Login successful', schema: loginSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Invalid credentials', schema: errorSchema },
    { status: 423, description: 'Account locked', schema: errorSchema },
    { status: 429, description: 'Too many login attempts', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer login',
  description: 'Handles customer authentication and session issuance.',
  methods: { POST: methodDoc },
}
