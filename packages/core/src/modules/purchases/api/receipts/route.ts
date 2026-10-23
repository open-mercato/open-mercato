import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PurchaseReceipt } from '../../data/entities'
import { resolvePurchasesApiContext, formatZodError } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.string().optional(),
  orderId: z.string().uuid().optional(),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const url = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))

    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const { page, pageSize, search, status, orderId } = parsed.data
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    }

    if (status && status.trim()) where.status = status.trim()
    if (orderId) where.purchaseOrder = orderId
    if (search && search.trim()) {
      where.receiptNumber = { $ilike: `%${search.trim()}%` }
    }

    const [items, total] = await ctx.em.findAndCount(PurchaseReceipt, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' },
      populate: ['lines', 'purchaseOrder'],
    })

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
