import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { invitationAcceptSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'

export const metadata: { path?: string } = {}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = invitationAcceptSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerInvitationService = container.resolve('customerInvitationService') as CustomerInvitationService
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService

  const result = await customerInvitationService.acceptInvitation(
    parsed.data.token,
    parsed.data.password,
    parsed.data.displayName,
  )
  if (!result) {
    return NextResponse.json({ ok: false, error: 'Invalid or expired invitation' }, { status: 400 })
  }

  const { user, invitation } = result
  const acl = await customerRbacService.loadAcl(user.id, {
    tenantId: user.tenantId,
    organizationId: user.organizationId,
  })
  const resolvedFeatures = acl.features

  const ip = getClientIp(req, 0)
  const userAgent = req.headers.get('user-agent') || null
  const { rawToken, jwt } = await customerSessionService.createSession(user, resolvedFeatures, ip, userAgent)

  void emitCustomerAccountsEvent('customer_accounts.user.created', {
    id: user.id,
    email: user.email,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    invitationId: invitation.id,
  }).catch(() => undefined)

  void emitCustomerAccountsEvent('customer_accounts.invitation.accepted', {
    invitationId: invitation.id,
    userId: user.id,
    tenantId: user.tenantId,
  }).catch(() => undefined)

  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: true,
    },
    resolvedFeatures,
  }, { status: 201 })

  res.cookies.set('customer_auth_token', jwt, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8,
  })
  res.cookies.set('customer_session_token', rawToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })

  return res
}

const acceptSuccessSchema = z.object({
  ok: z.literal(true),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    emailVerified: z.boolean(),
  }),
  resolvedFeatures: z.array(z.string()),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Accept customer invitation',
  description: 'Accepts an invitation, creates the user account, assigns roles, and auto-logs in.',
  tags: ['Customer Authentication'],
  requestBody: {
    schema: invitationAcceptSchema,
    description: 'Invitation acceptance with token, password, and display name.',
  },
  responses: [
    { status: 201, description: 'Invitation accepted and user created', schema: acceptSuccessSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid or expired invitation', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Accept customer invitation',
  description: 'Handles invitation acceptance for customer accounts.',
  methods: { POST: methodDoc },
}
