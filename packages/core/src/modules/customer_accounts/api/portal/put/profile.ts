import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { profileUpdateSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

export const metadata = {}

export async function PUT(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  try {
    requireCustomerFeature(auth, ['portal.account.manage'])
  } catch (response) {
    return response as NextResponse
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = profileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService

  const user = await customerUserService.findById(auth.sub)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  await customerUserService.updateProfile(user, parsed.data)

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  })
}

const successSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string().uuid(), email: z.string(), displayName: z.string() }),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Update customer profile',
  description: 'Updates the authenticated customer user profile.',
  tags: ['Customer Portal'],
  requestBody: { schema: profileUpdateSchema },
  responses: [{ status: 200, description: 'Profile updated', schema: successSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Update customer profile',
  methods: { PUT: methodDoc },
}

export default PUT
