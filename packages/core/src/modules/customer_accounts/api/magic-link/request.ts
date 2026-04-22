import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { magicLinkRequestSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  customerMagicLinkRateLimitConfig,
  customerMagicLinkIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: customerMagicLinkIpRateLimitConfig,
    compoundConfig: customerMagicLinkRateLimitConfig,
    compoundIdentifier: '',
  })
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const parsed = magicLinkRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: true })
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
    await customerTokenService.createMagicLink(user.id, tenantId)
    // Token is stored in DB; email delivery should be handled by a direct service call,
    // NOT via the event bus — raw tokens must never travel through events.
    void import('@open-mercato/core/modules/customer_accounts/events').then(({ emitCustomerAccountsEvent }) =>
      emitCustomerAccountsEvent('customer_accounts.magic_link.requested', {
        userId: user.id,
        tenantId,
        organizationId: user.organizationId,
      })
    ).catch(() => undefined)
  }

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Request magic link login',
  description: 'Sends a magic link to the customer email. Always returns 200 to prevent enumeration.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: magicLinkRequestSchema,
    description: 'Magic link request with email.',
  },
  responses: [
    { status: 200, description: 'Request accepted', schema: successSchema },
  ],
  errors: [
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Request customer magic link',
  description: 'Handles magic link login requests for customer accounts.',
  methods: { POST: methodDoc },
}
