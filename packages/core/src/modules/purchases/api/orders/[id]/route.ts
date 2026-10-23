import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PurchaseOrder } from '../../../data/entities'
import { purchaseOrderUpdateSchema } from '../../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
  PUT: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)

    const order = await ctx.em.findOne(
      PurchaseOrder,
      {
        id,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { populate: ['lines'] }
    )

    if (!order) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    return NextResponse.json(order)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)
    const json = await readJsonSafe(req)

    const parsed = purchaseOrderUpdateSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    // Check optimistic lock header if provided
    const expectedUpdatedAt = req.headers.get(OPTIMISTIC_LOCK_HEADER_NAME) || req.headers.get('if-match')
    if (expectedUpdatedAt) {
      const current = await ctx.em.findOne(
        PurchaseOrder,
        { id, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
        { fields: ['updatedAt'] }
      )
      if (current && current.updatedAt.toISOString() !== expectedUpdatedAt.replace(/^"|"$/g, '')) {
        return NextResponse.json(
          {
            error: 'Conflict: the purchase order was modified by another transaction',
            code: 'OPTIMISTIC_LOCK_CONFLICT',
            currentUpdatedAt: current.updatedAt.toISOString(),
          },
          { status: 409 }
        )
      }
    }

    const updated = await ctx.purchaseOrderService.updateOrder(
      id,
      { organizationId: ctx.organizationId, tenantId: ctx.tenantId },
      parsed.data
    )

    return NextResponse.json(updated)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)

    const order = await ctx.em.findOne(PurchaseOrder, {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })

    if (!order) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    if (order.status !== 'draft_rfq' && order.status !== 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot delete order that is not in draft or cancelled status' },
        { status: 400 }
      )
    }

    order.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
