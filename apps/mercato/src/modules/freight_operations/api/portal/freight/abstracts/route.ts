import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { FreightTripAbstract, FreightTripAbstractLine } from '../../../../data/entities'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/portal/freight/abstracts',
  GET: { requireAuth: false },
}

const VISIBLE_STATUSES = ['submitted', 'disputed', 'approved', 'invoiced', 'cancelled'] as const

function customerIds(customerEntityId: string | null | undefined, personEntityId: string | null | undefined): string[] {
  return [customerEntityId, personEntityId].filter((id): id is string => Boolean(id))
}

export async function GET(req: Request) {
  try {
    const auth = await getCustomerAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const ids = customerIds(auth.customerEntityId, auth.personEntityId)
    if (!ids.length) return NextResponse.json({ items: [], total: 0 })
    const di = await createRequestContainer()
    const em = di.resolve('em') as EntityManager
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const where: Record<string, unknown> = {
      ...scope,
      customerId: { $in: ids },
      status: { $in: VISIBLE_STATUSES },
      deletedAt: null,
    }
    if (id) where.id = id
    const abstracts = await findWithDecryption(em, FreightTripAbstract, where, {
      orderBy: { submittedAt: 'desc', createdAt: 'desc' },
      limit: 100,
    }, scope) as FreightTripAbstract[]
    const lines = id && abstracts.length
      ? await findWithDecryption(em, FreightTripAbstractLine, {
          ...scope,
          abstract: abstracts[0].id,
          isBillable: true,
          deletedAt: null,
        }, { orderBy: { lineNumber: 'asc' } }, scope) as FreightTripAbstractLine[]
      : []
    return NextResponse.json({
      items: abstracts.map((abstract) => ({
        id: abstract.id,
        abstractNumber: abstract.abstractNumber,
        customerId: abstract.customerId,
        periodFrom: abstract.periodFrom,
        periodTo: abstract.periodTo,
        status: abstract.status,
        currencyCode: abstract.currencyCode,
        tripCount: abstract.tripCount,
        subtotalNetAmount: abstract.subtotalNetAmount,
        taxTotalAmount: abstract.taxTotalAmount,
        grandTotalGrossAmount: abstract.grandTotalGrossAmount,
        submittedAt: abstract.submittedAt ?? null,
        requiresCustomerApproval: abstract.requiresCustomerApproval,
        lines: abstract.id === abstracts[0]?.id
          ? lines.map((line) => ({
              id: line.id,
              lineNumber: line.lineNumber,
              executionDate: line.executionDate,
              origin: line.origin,
              destination: line.destination,
              description: line.description ?? null,
              quantity: line.quantity,
              totalNetAmount: line.totalNetAmount,
              taxAmount: line.taxAmount,
              totalGrossAmount: line.totalGrossAmount,
              disputeStatus: line.disputeStatus,
              disputeNote: line.disputeNote ?? null,
            }))
          : undefined,
      })),
      total: abstracts.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('freight_operations.portal_abstracts.failed', { err })
    return NextResponse.json({ error: 'Failed to load abstracts' }, { status: 500 })
  }
}
