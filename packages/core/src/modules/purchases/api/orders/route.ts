import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PurchaseOrder } from '../../data/entities'
import { purchaseOrderCreateSchema } from '../../data/validators'
import { resolvePurchasesApiContext } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.string().optional(),
  vendorId: z.string().uuid().optional(),
  sortField: z.enum(['orderNumber', 'orderDate', 'totalGross', 'status', 'updatedAt']).default('updatedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const url = new URL(req.url)
    const parsedQuery = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))

    if (!parsedQuery.success) {
      const message = parsedQuery.error.issues.map((i) => `${i.path.join('.') || 'param'}: ${i.message}`).join('; ')
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { page, pageSize, search, status, vendorId, sortField, sortDir } = parsedQuery.data

    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    }

    if (status && status.trim()) {
      where.status = status.trim()
    }

    if (vendorId) {
      where.vendorId = vendorId
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`
      where.$or = [
        { orderNumber: { $ilike: q } },
        { vendorName: { $ilike: q } },
        { notes: { $ilike: q } },
      ]
    }

    const [items, total] = await ctx.em.findAndCount(PurchaseOrder, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
      populate: ['lines'],
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

export async function POST(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const json = await readJsonSafe(req)
    const parsed = purchaseOrderCreateSchema.safeParse(json)

    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'field'}: ${i.message}`).join('; ')
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const order = await ctx.purchaseOrderService.createOrder(
      { organizationId: ctx.organizationId, tenantId: ctx.tenantId },
      parsed.data,
      ctx.auth.userId
    )

    return NextResponse.json(order, { status: 201 })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
