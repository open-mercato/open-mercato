import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { passwordResetRequestSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import {
  resolveTenantContext,
  TenantResolutionError,
} from '@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  checkAuthRateLimit,
  customerPasswordResetRateLimitConfig,
  customerPasswordResetIpRateLimitConfig,
} from '@open-mercato/core/modules/customer_accounts/lib/rateLimiter'
import { readNormalizedEmailFromJsonRequest } from '@open-mercato/core/modules/customer_accounts/lib/rateLimitIdentifier'
import { getPasswordResetDeliveryQueue } from '@open-mercato/core/modules/customer_accounts/lib/authLinkQueue'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

export async function POST(req: Request) {
  const rateLimitEmail = await readNormalizedEmailFromJsonRequest(req)
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: customerPasswordResetIpRateLimitConfig,
    compoundConfig: customerPasswordResetRateLimitConfig,
    compoundIdentifier: rateLimitEmail,
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

  const { email } = parsed.data
  let tenantId: string
  try {
    const context = await resolveTenantContext(req, parsed.data.tenantId)
    tenantId = context.tenantId
  } catch (err) {
    if (err instanceof TenantResolutionError) {
      // Always return 200 to avoid leaking whether a tenant exists for this host.
      return NextResponse.json({ ok: true })
    }
    throw err
  }

  // Lookup, token minting and email delivery all happen inside a queue worker
  // (see workers/passwordResetDelivery.ts) so the response never depends on
  // whether the account exists — known and unknown emails return identically,
  // without waiting on a DB write or outbound email transport latency (#8889).
  await getPasswordResetDeliveryQueue().enqueue({ email, tenantId })

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
