import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser, CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'

export const metadata = {}

const paramsSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
})

export async function DELETE(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const parsedParams = paramsSchema.safeParse(params)
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, error: 'Invalid identifier' }, { status: 400 })
  }
  const { id: userId, sessionId } = parsedParams.data

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

  const em = container.resolve('em') as EntityManager
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const user = await findOneWithDecryption(
    em,
    CustomerUser,
    { id: userId, tenantId: auth.tenantId, organizationId: auth.orgId, deletedAt: null } as any,
    undefined,
    scope,
  )
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const session = await findOneWithDecryption(
    em,
    CustomerUserSession,
    { id: sessionId, user: user.id as any, deletedAt: null } as any,
    undefined,
    scope,
  )
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Session not found' }, { status: 404 })
  }

  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService
  await customerSessionService.revokeSession(session.id)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Revoke a customer user session (admin)',
  description: 'Allows staff to end one active portal session of a customer user. The customer is signed out of that session on the next request.',
  tags: ['Customer Accounts Admin'],
  responses: [{ status: 200, description: 'Session revoked', schema: successSchema }],
  errors: [
    { status: 400, description: 'Invalid identifier', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User or session not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Revoke customer user session (admin)',
  pathParams: paramsSchema,
  methods: { DELETE: methodDoc },
}
