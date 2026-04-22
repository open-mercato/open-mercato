import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { signupSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerRole, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  customerSignupRateLimitConfig,
  customerSignupIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: customerSignupIpRateLimitConfig,
    compoundConfig: customerSignupRateLimitConfig,
    compoundIdentifier: '',
  })
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const { email, password, displayName, tenantId, organizationId } = parsed.data
  if (!tenantId || !organizationId) {
    return NextResponse.json({ ok: false, error: 'tenantId and organizationId are required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const [orgRow] = await em.getConnection().execute(
    `SELECT 1 FROM organizations WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [organizationId],
  )
  if (!orgRow) {
    return NextResponse.json({ ok: false, error: 'Registration could not be completed' }, { status: 400 })
  }

  const existing = await customerUserService.findByEmail(email, tenantId)
  if (existing) {
    return NextResponse.json({ ok: false, error: 'Registration could not be completed' }, { status: 400 })
  }

  const user = await customerUserService.createUser(email, password, displayName, { tenantId, organizationId })

  const defaultRole = await em.findOne(CustomerRole, {
    tenantId,
    isDefault: true,
    deletedAt: null,
  })
  if (defaultRole) {
    const userRole = em.create(CustomerUserRole, {
      user,
      role: defaultRole,
      createdAt: new Date(),
    } as any)
    em.persist(userRole)
  }

  await em.persistAndFlush(user)

  await customerTokenService.createEmailVerification(user.id, tenantId)

  void emitCustomerAccountsEvent('customer_accounts.user.created', {
    id: user.id,
    email: user.email,
    tenantId,
    organizationId,
  }).catch(() => undefined)

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: false,
    },
  }, { status: 201 })
}

const signupSuccessSchema = z.object({
  ok: z.literal(true),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    emailVerified: z.boolean(),
  }),
})

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const methodDoc: OpenApiMethodDoc = {
  summary: 'Register a new customer account',
  description: 'Creates a new customer user account and sends an email verification token.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: signupSchema,
    description: 'Signup payload with email, password, and display name.',
  },
  responses: [
    { status: 201, description: 'Account created successfully', schema: signupSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 409, description: 'Email already registered', schema: errorSchema },
    { status: 429, description: 'Too many signup attempts', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer account registration',
  description: 'Handles customer self-registration.',
  methods: { POST: methodDoc },
}
