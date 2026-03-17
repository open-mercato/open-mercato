import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { passwordResetRequestSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  customerPasswordResetRateLimitConfig,
  customerPasswordResetIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: customerPasswordResetIpRateLimitConfig,
    compoundConfig: customerPasswordResetRateLimitConfig,
    compoundIdentifier: '',
  })
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true }) // Always 200
  }

  const parsed = passwordResetRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: true }) // Always 200 to prevent enumeration
  }

  const { email, tenantId } = parsed.data
  if (!tenantId) {
    return NextResponse.json({ ok: true })
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService

  const user = await customerUserService.findByEmail(email, tenantId)
  if (user) {
    const token = await customerTokenService.createPasswordReset(user.id, tenantId)
    // Token would be sent via email in production; emitting event for subscribers to handle
    void import('@open-mercato/core/modules/customer_accounts/events').then(({ emitCustomerAccountsEvent }) =>
      emitCustomerAccountsEvent('customer_accounts.password.reset', {
        userId: user.id,
        email: user.email,
        tenantId,
        token,
      })
    ).catch(() => undefined)
  }

  // Always return 200 to prevent email enumeration
  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Request customer password reset',
  description: 'Initiates a password reset flow. Always returns 200 to prevent email enumeration.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: passwordResetRequestSchema,
    description: 'Password reset request with email.',
  },
  responses: [
    { status: 200, description: 'Request accepted', schema: successSchema },
  ],
  errors: [
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer password reset request',
  description: 'Handles password reset initiation for customer accounts.',
  methods: { POST: methodDoc },
}
