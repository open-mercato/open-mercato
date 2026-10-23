import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PurchaseBill } from '../../../data/entities'
import { resolvePurchasesApiContext } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.bills.view'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id?: string }> | { id?: string } }
) {
  try {
    const rawParams = await params
    const id = rawParams?.id
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const ctx = await resolvePurchasesApiContext(req)

    const bill = await ctx.em.findOne(
      PurchaseBill,
      {
        id,
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        deletedAt: null,
      },
      { populate: ['lines', 'purchaseOrder'] }
    )

    if (!bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    return NextResponse.json({
      item: {
        id: bill.id,
        vendorBillNumber: bill.vendorBillNumber,
        purchaseOrderId: bill.purchaseOrder.id,
        purchaseOrderNumber: bill.purchaseOrder.orderNumber,
        controlPolicy: bill.purchaseOrder.controlPolicy,
        billDate: bill.billDate,
        status: bill.status,
        matchingStatus: bill.matchingStatus,
        exceptionNotes: bill.exceptionNotes,
        totalNet: bill.totalNet,
        totalGross: bill.totalGross,
        createdAt: bill.createdAt,
        updatedAt: bill.updatedAt,
        lines: bill.lines.getItems().map((l) => ({
          id: l.id,
          orderLineId: l.orderLineId,
          productId: l.productId,
          productDescription: l.productDescription,
          quantity: l.quantity,
          unitPriceNet: l.unitPriceNet,
          subtotalNet: l.subtotalNet,
        })),
      },
    })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
