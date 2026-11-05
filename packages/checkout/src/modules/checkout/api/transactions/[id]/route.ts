import { NextResponse } from 'next/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink, CheckoutTransaction } from '../../../data/entities'
import { handleCheckoutRouteError, requireAdminContext, userHasCheckoutFeature } from '../../helpers'
import { checkoutTag } from '../../openapi'
import { serializeTransaction } from '../../../lib/utils'

export const metadata = {
  path: '/checkout/transactions/[id]',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, container, em } = await requireAdminContext(req)
    const canViewPii = await userHasCheckoutFeature(container, auth, 'checkout.viewPii')
    const resolvedParams = await params
    const transaction = await findOneWithDecryption(
      em,
      CheckoutTransaction,
      {
        id: resolvedParams.id,
        organizationId: auth.orgId,
        tenantId: auth.tenantId,
      },
      undefined,
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: transaction.linkId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }, undefined, { organizationId: auth.orgId, tenantId: auth.tenantId })
    return NextResponse.json({
      transaction: serializeTransaction(transaction, link, canViewPii),
      link: link
        ? {
          id: link.id,
          name: link.name,
          slug: link.slug,
          pricingMode: link.pricingMode,
        }
        : null,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
