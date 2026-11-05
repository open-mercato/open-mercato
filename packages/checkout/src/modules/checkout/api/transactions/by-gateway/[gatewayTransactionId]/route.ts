import { NextResponse } from 'next/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink, CheckoutTransaction } from '../../../../data/entities'
import { handleCheckoutRouteError, requireAdminContext } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

export const metadata = {
  path: '/checkout/transactions/by-gateway/[gatewayTransactionId]',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ gatewayTransactionId: string }> | { gatewayTransactionId: string } },
) {
  try {
    const { auth, em } = await requireAdminContext(req)
    const resolvedParams = await params
    const transaction = await findOneWithDecryption(em, CheckoutTransaction, {
      gatewayTransactionId: resolvedParams.gatewayTransactionId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    }, undefined, { organizationId: auth.orgId, tenantId: auth.tenantId })
    if (!transaction) {
      return NextResponse.json({ transaction: null }, { status: 200 })
    }
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: transaction.linkId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }, undefined, { organizationId: auth.orgId, tenantId: auth.tenantId })
    return NextResponse.json({
      transaction: {
        id: transaction.id,
        linkSlug: link?.slug ?? null,
        linkName: link?.name ?? null,
      },
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
