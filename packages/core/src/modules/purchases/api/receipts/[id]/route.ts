import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PurchaseReceipt } from '../../../data/entities'
import { resolvePurchasesApiContext } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)

    const receipt = await ctx.em.findOne(
      PurchaseReceipt,
      { id, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
      { populate: ['lines', 'purchaseOrder'] }
    )

    if (!receipt) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
    }

    return NextResponse.json(receipt)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
