import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { magicLinkVerifySchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = magicLinkVerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const result = await customerTokenService.verifyEmailToken(parsed.data.token, 'magic_link')
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  }

  const user = await customerUserService.findById(result.userId, result.tenantId)
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: false, error: 'Account not found or deactivated' }, { status: 401 })
  }

  // Auto-verify email on magic link login
  if (!user.emailVerifiedAt) {
    await em.nativeUpdate(CustomerUser, { id: user.id }, { emailVerifiedAt: new Date() })
    user.emailVerifiedAt = new Date()
  }

  await customerUserService.resetFailedAttempts(user)
  await customerUserService.updateLastLoginAt(user)

  const acl = await customerRbacService.loadAcl(user.id, { tenantId: user.tenantId, organizationId: user.organizationId })
  const resolvedFeatures = acl.features

  const ip = getClientIp(req, 0)
  const userAgent = req.headers.get('user-agent') || null
  const { rawToken, jwt } = await customerSessionService.createSession(user, resolvedFeatures, ip, userAgent)

  void emitCustomerAccountsEvent('customer_accounts.login.success', {
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
  }).catch(() => undefined)

  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
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

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Verify magic link token',
  description: 'Validates the magic link token, auto-verifies email, and creates a session.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: magicLinkVerifySchema,
    description: 'Magic link verification token.',
  },
  responses: [
    { status: 200, description: 'Login successful', schema: loginSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid or expired token', schema: errorSchema },
    { status: 401, description: 'Account not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Verify customer magic link',
  description: 'Handles magic link verification and auto-login.',
  methods: { POST: methodDoc },
}
