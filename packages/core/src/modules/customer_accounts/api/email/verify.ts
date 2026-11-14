import { NextResponse } from 'next/server'
import { runWithDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { emailVerifySchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = emailVerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService

  const result = await customerTokenService.verifyEmailToken(parsed.data.token, 'email_verification')
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  }

  return runWithDatabaseExecutionContext({ kind: 'tenant', tenantId: result.tenantId, source: 'public-token', operation: 'customer-email-verification' }, async () => {
    const tenantContainer = await createRequestContainer()
    try {
      const em = tenantContainer.resolve('em') as import('@mikro-orm/postgresql').EntityManager

      await em.nativeUpdate(CustomerUser, { id: result.userId, tenantId: result.tenantId }, { emailVerifiedAt: new Date() })

      await emitCustomerAccountsEvent('customer_accounts.email.verified', {
        userId: result.userId,
        recipientUserId: result.userId,
        tenantId: result.tenantId,
      }).catch(() => undefined)

      return NextResponse.json({ ok: true })
    } finally {
      await tenantContainer.dispose()
    }
  })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Verify customer email address',
  description: 'Validates the email verification token and marks the email as verified.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: emailVerifySchema,
    description: 'Email verification token.',
  },
  responses: [
    { status: 200, description: 'Email verified', schema: successSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid or expired token', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Verify customer email',
  description: 'Handles email verification for customer accounts.',
  methods: { POST: methodDoc },
}
