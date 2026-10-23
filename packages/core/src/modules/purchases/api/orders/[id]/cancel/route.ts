import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolvePurchasesApiContext } from '../../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)

    const order = await ctx.purchaseOrderService.cancelOrder(id, {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
    })

    return NextResponse.json(order)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
