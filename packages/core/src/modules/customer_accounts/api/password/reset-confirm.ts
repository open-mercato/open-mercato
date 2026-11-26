import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { passwordResetConfirmSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import type { EntityManager } from '@mikro-orm/postgresql'
import { requireCustomerPortalEnabled } from '@open-mercato/core/modules/customer_accounts/lib/portalAccess'
import { emitCustomerEmailVerified, verifyCustomerEmail } from '../../lib/verifyCustomerEmail'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = passwordResetConfirmSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService

  const em = container.resolve('em') as EntityManager
  const result = await em.transactional(async (tx) => {
    const identity = await customerTokenService.verifyPasswordResetToken(
      parsed.data.token, undefined, tx,
      (tenantId) => requireCustomerPortalEnabled(container, tenantId),
    )
    if (!identity) return null
    return verifyCustomerEmail(tx, identity, customerSessionService, {
      password: parsed.data.password,
      users: customerUserService,
      reset: true,
    })
  })
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  }
  const { user, newlyVerified } = result
  if (newlyVerified) emitCustomerEmailVerified(user)

  void emitCustomerAccountsEvent('customer_accounts.password.changed', {
    userId: user.id,
    tenantId: user.tenantId,
    organizationId: user.organizationId ?? null,
    changedBy: 'reset',
    changedById: null,
    at: new Date().toISOString(),
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Confirm customer password reset',
  description: 'Validates the reset token and sets a new password. Revokes all existing sessions.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: passwordResetConfirmSchema,
    description: 'Password reset confirmation with token and new password.',
  },
  responses: [
    { status: 200, description: 'Password reset successful', schema: successSchema },
  ],
  errors: [
    { status: 403, description: 'Customer portal is disabled', schema: errorSchema },
    { status: 400, description: 'Invalid or expired token', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Confirm customer password reset',
  description: 'Handles password reset confirmation for customer accounts.',
  methods: { POST: methodDoc },
}
