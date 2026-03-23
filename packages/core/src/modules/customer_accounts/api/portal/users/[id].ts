import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata: { path?: string } = {}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
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

  if (params.id === auth.sub) {
    return NextResponse.json({ ok: false, error: 'Cannot delete your own account' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService

  const targetUser = await em.findOne(CustomerUser, {
    id: params.id,
    customerEntityId: auth.customerEntityId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!targetUser) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  await customerUserService.softDelete(targetUser.id)
  await customerSessionService.revokeAllUserSessions(targetUser.id)

  void emitCustomerAccountsEvent('customer_accounts.user.deleted', {
    id: targetUser.id,
    email: targetUser.email,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Delete a company portal user',
  description: 'Soft deletes a portal user and revokes all their sessions.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'User deleted', schema: successSchema }],
  errors: [
    { status: 400, description: 'Cannot delete self', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Delete portal user',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { DELETE: methodDoc },
}
