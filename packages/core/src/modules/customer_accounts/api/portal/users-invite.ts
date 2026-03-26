import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import { CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { inviteUserSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  try {
    requireCustomerFeature(auth, ['portal.users.manage'])
  } catch (response) {
    return response as NextResponse
  }

  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'No company association' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = inviteUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  // Validate all roles are customer_assignable
  for (const roleId of parsed.data.roleIds) {
    const role = await em.findOne(CustomerRole, { id: roleId, tenantId: auth.tenantId, deletedAt: null })
    if (!role) {
      return NextResponse.json({ ok: false, error: `Role ${roleId} not found` }, { status: 400 })
    }
    if (!role.customerAssignable) {
      return NextResponse.json({ ok: false, error: `Role "${role.name}" cannot be assigned by portal users` }, { status: 403 })
    }
  }

  const customerInvitationService = container.resolve('customerInvitationService') as CustomerInvitationService

  const { invitation } = await customerInvitationService.createInvitation(
    parsed.data.email,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
    {
      customerEntityId: auth.customerEntityId,
      roleIds: parsed.data.roleIds,
      invitedByCustomerUserId: auth.sub,
      displayName: parsed.data.displayName || null,
    },
  )

  return NextResponse.json({
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    },
  }, { status: 201 })
}

const successSchema = z.object({
  ok: z.literal(true),
  invitation: z.object({
    id: z.string().uuid(),
    email: z.string(),
    expiresAt: z.string().datetime(),
  }),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Invite a user to the company portal',
  description: 'Creates an invitation for a new user to join the company portal.',
  tags: ['Customer Portal'],
  requestBody: { schema: inviteUserSchema },
  responses: [{ status: 201, description: 'Invitation created', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions or non-assignable role', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Invite portal user',
  methods: { POST: methodDoc },
}
