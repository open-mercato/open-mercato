import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { passwordResetConfirmSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'

export const metadata: { path?: string } = {}

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

  const result = await customerTokenService.verifyPasswordResetToken(parsed.data.token)
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  }

  await customerUserService.updatePassword(
    { id: result.userId } as any,
    parsed.data.password,
  )

  // Revoke all existing sessions for security
  await customerSessionService.revokeAllUserSessions(result.userId)

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
    { status: 400, description: 'Invalid or expired token', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Confirm customer password reset',
  description: 'Handles password reset confirmation for customer accounts.',
  methods: { POST: methodDoc },
}
