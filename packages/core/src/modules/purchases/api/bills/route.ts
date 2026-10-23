import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { purchaseBillCreateSchema } from '../../data/validators'
import { PurchaseBill } from '../../data/entities'
import { resolvePurchasesApiContext, formatZodError } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.bills.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchases.bills.manage'] },
}

const billQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(20),
  orderId: z.string().uuid().optional(),
  status: z.string().optional(),
  matchingStatus: z.string().optional(),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const { searchParams } = new URL(req.url)
    const parsed = billQuerySchema.safeParse(Object.fromEntries(searchParams.entries()))

    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const { page, pageSize, orderId, status, matchingStatus } = parsed.data

    const where: Record<string, unknown> = {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    }

    if (orderId) where.purchaseOrder = orderId
    if (status) where.status = status
    if (matchingStatus) where.matchingStatus = matchingStatus

    const [items, total] = await ctx.em.findAndCount(PurchaseBill, where, {
      populate: ['lines', 'purchaseOrder'],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'DESC' },
    })

    return NextResponse.json({
      items: items.map((b) => ({
        id: b.id,
        vendorBillNumber: b.vendorBillNumber,
        purchaseOrderId: b.purchaseOrder.id,
        purchaseOrderNumber: b.purchaseOrder.orderNumber,
        billDate: b.billDate,
        status: b.status,
        matchingStatus: b.matchingStatus,
        exceptionNotes: b.exceptionNotes,
        totalNet: b.totalNet,
        totalGross: b.totalGross,
        linesCount: b.lines.length,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const body = await readJsonSafe(req)
    const parsed = purchaseBillCreateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 422 }
      )
    }

    const bill = await ctx.threeWayMatchService.createBill(parsed.data, {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
    })

    return NextResponse.json({ item: bill }, { status: 201 })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
