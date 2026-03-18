import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { GatewayTransaction } from '../../../data/entities'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  path: '/payment_gateways/transactions/document-types',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const qb = em.createQueryBuilder(GatewayTransaction, 'gt')

  const rows = await qb
    .select('gt.document_type')
    .where({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
      documentType: { $ne: null },
    })
    .groupBy('gt.document_type')
    .orderBy({ documentType: 'asc' })
    .execute<Array<{ document_type: string }>>()

  return NextResponse.json({
    items: rows.map((row) => row.document_type),
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'List distinct document types linked to transactions',
  methods: {
    GET: {
      summary: 'List transaction document types',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Distinct document type list' },
      ],
    },
  },
}

export default GET
