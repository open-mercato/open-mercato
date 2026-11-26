import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { CustomerSessionService } from '../../../../services/customerSessionService'
import { emitCustomerEmailVerified, verifyCustomerEmail } from '../../../../lib/verifyCustomerEmail'

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

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }
  const scope = { userId: params.id, tenantId: auth.tenantId, organizationId: auth.orgId }
  const sessions = container.resolve<CustomerSessionService>('customerSessionService')
  const result = await em.transactional((tx) => verifyCustomerEmail(tx, scope, sessions))
  if (!result) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }
  if (!result.newlyVerified) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }
  emitCustomerEmailVerified(result.user, auth.sub)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true), alreadyVerified: z.boolean().optional() })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Verify customer user email (admin)',
  description: 'Allows staff to manually mark a customer user email as verified.',
  tags: ['Customer Accounts Admin'],
  responses: [{ status: 200, description: 'Email verified', schema: successSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Verify customer user email (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { POST: methodDoc },
}
