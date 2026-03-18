import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
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

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const user = await em.findOne(CustomerUser, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  if (user.emailVerifiedAt) {
    return NextResponse.json({ ok: true, alreadyVerified: true })
  }

  await em.nativeUpdate(CustomerUser, { id: user.id }, { emailVerifiedAt: new Date() })

  void emitCustomerAccountsEvent('customer_accounts.email.verified', {
    id: user.id,
    email: user.email,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    verifiedBy: auth.sub,
  }).catch(() => undefined)

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
