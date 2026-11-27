import { NextResponse } from 'next/server'
import { runWithDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { runInOwnedRequestScope } from '@open-mercato/shared/lib/di/request-scope'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { emailVerifySchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import type { CustomerSessionService } from '../../services/customerSessionService'
import type { CustomerUserService } from '../../services/customerUserService'
import { emitCustomerEmailVerified, verifyCustomerEmail } from '../../lib/verifyCustomerEmail'

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

  const result = await runWithDatabaseExecutionContext(
    { kind: 'identity', tenantId: null, source: 'identity', operation: 'customer-email-verification-identity' },
    () => runInOwnedRequestScope(async () => {
      const container = await createRequestContainer()
      const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService
      const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

      const sessions = container.resolve<CustomerSessionService>('customerSessionService')
      const { token, password } = parsed.data
      return em.transactional(async (tx) => {
        const identity = await customerTokenService.verifyEmailToken(token, 'email_verification', undefined, tx)
        if (!identity) return null
        const credentials = password === undefined
          ? undefined
          : { password, users: container.resolve<CustomerUserService>('customerUserService') }
        return verifyCustomerEmail(tx, identity, sessions, credentials)
      })
    }),
  )
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  }

  const { user, newlyVerified } = result
  if (!newlyVerified) return NextResponse.json({ ok: true })

  return runWithDatabaseExecutionContext({ kind: 'tenant', tenantId: user.tenantId, source: 'public-token', operation: 'customer-email-verification' },
    () => runInOwnedRequestScope(async () => {
      await createRequestContainer()
      await emitCustomerEmailVerified(user)
      return NextResponse.json({ ok: true })
    }),
  )
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Verify customer email address',
  description: 'Verifies the email and optionally sets a password chosen by the email recipient.',
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
