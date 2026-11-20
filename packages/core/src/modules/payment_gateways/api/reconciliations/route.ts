import { NextResponse } from 'next/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import type { EntityManager } from '@mikro-orm/postgresql'
import { listReconciliationsSchema } from '../../data/validators'
import { listReconciliations } from '../../lib/reconciliation'
import { resolvePaymentGatewayTranslator } from '../../lib/order-amount-reconciliation'
import { paymentGatewaysTag } from '../openapi'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] } }

export async function GET(request: Request, context: { auth: AuthContext }) {
  const translate = await resolvePaymentGatewayTranslator()
  const auth = context.auth
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: translate('payment_gateways.reconciliation.errors.unauthorized') }, { status: 401 })
  const query = listReconciliationsSchema.safeParse(buildQueryParams(new URL(request.url).searchParams))
  if (!query.success) return NextResponse.json({ error: translate('payment_gateways.reconciliation.errors.invalidPayload') }, { status: 422 })
  const container = await createRequestContainer()
  return NextResponse.json(await listReconciliations(container.resolve<EntityManager>('em'), {
    tenantId: auth.tenantId, organizationId: auth.orgId,
  }, query.data))
}

export const openApi = {
  tags: [paymentGatewaysTag], summary: 'List capture reconciliation obligations',
  methods: { GET: { summary: 'List capture reconciliation obligations', query: listReconciliationsSchema, responses: [{ status: 200, description: 'Scoped reconciliation worklist' }] } },
}
