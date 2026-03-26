import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata = {}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.manage'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const user = await customerUserService.findById(params.id, auth.tenantId!)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const customerTokenService = container.resolve('customerTokenService') as CustomerTokenService
  const rawToken = await customerTokenService.createPasswordReset(user.id, auth.tenantId!)

  const resetLink = `/portal/reset-password?token=${rawToken}`

  void emitCustomerAccountsEvent('customer_accounts.password.reset', {
    id: user.id,
    email: user.email,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    resetBy: auth.sub,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, resetLink })
}

const successSchema = z.object({ ok: z.literal(true), resetLink: z.string() })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Send password reset link for customer user (admin)',
  description: 'Creates a password reset token for a customer user and returns a reset link URL. The admin must prepend the appropriate portal domain/slug to the relative URL.',
  tags: ['Customer Accounts Admin'],
  responses: [{ status: 200, description: 'Reset link generated', schema: successSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Send password reset link for customer user (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { POST: methodDoc },
}
