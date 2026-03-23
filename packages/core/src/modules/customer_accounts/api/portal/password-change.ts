import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { passwordChangeSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = passwordChangeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService

  const user = await customerUserService.findById(auth.sub, auth.tenantId)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const currentValid = await customerUserService.verifyPassword(user, parsed.data.currentPassword)
  if (!currentValid) {
    return NextResponse.json({ ok: false, error: 'Current password is incorrect' }, { status: 400 })
  }

  await customerUserService.updatePassword(user, parsed.data.newPassword)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Change customer password',
  description: 'Changes the authenticated customer user password after verifying the current password.',
  tags: ['Customer Portal'],
  requestBody: { schema: passwordChangeSchema },
  responses: [{ status: 200, description: 'Password changed', schema: successSchema }],
  errors: [
    { status: 400, description: 'Current password incorrect or validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Change customer password',
  methods: { POST: methodDoc },
}
