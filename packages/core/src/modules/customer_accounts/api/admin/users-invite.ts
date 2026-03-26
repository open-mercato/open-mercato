import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import { inviteUserSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

export const metadata = {}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.invite'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
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

  const customerInvitationService = container.resolve('customerInvitationService') as CustomerInvitationService

  const { invitation } = await customerInvitationService.createInvitation(
    parsed.data.email,
    { tenantId: auth.tenantId!, organizationId: auth.orgId! },
    {
      customerEntityId: parsed.data.customerEntityId || null,
      roleIds: parsed.data.roleIds,
      invitedByUserId: auth.sub,
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
  summary: 'Invite customer user (admin)',
  description: 'Creates a staff-initiated invitation for a new customer user. The invitedByUserId is set from the staff auth context.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: inviteUserSchema },
  responses: [{ status: 201, description: 'Invitation created', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Invite customer user (admin)',
  methods: { POST: methodDoc },
}
