import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { reorderingRuleCreateSchema } from '../../data/validators'
import { ReorderingRule, PurchaseOrderLine } from '../../data/entities'
import { resolvePurchasesApiContext, formatZodError } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.reordering.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchases.reordering.manage'] },
}

const ruleQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(20),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const { searchParams } = new URL(req.url)
    const parsed = ruleQuerySchema.safeParse(Object.fromEntries(searchParams.entries()))

    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const { page, pageSize, productId, warehouseId } = parsed.data

    const where: Record<string, unknown> = {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    }

    if (productId) where.productId = productId
    if (warehouseId) where.warehouseId = warehouseId

    const [items, total] = await ctx.em.findAndCount(ReorderingRule, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'DESC' },
    })

    const productIds = items.map((r) => r.productId)
    const inboundMap = new Map<string, number>()
    if (productIds.length > 0) {
      const activeLines = await ctx.em.find(
        PurchaseOrderLine,
        {
          organizationId: ctx.organizationId,
          tenantId: ctx.tenantId,
          productId: { $in: productIds },
          purchaseOrder: {
            status: { $in: ['purchase_order', 'to_approve'] },
            deletedAt: null,
          },
          deletedAt: null,
        },
        { populate: ['purchaseOrder'] }
      )
      for (const line of activeLines) {
        const remaining = Math.max(0, Number(line.quantityOrdered) - Number(line.quantityReceived))
        inboundMap.set(line.productId, (inboundMap.get(line.productId) ?? 0) + remaining)
      }
    }

    return NextResponse.json({
      items: items.map((r) => {
        const inboundStock = inboundMap.get(r.productId) ?? 0
        const virtualStock = inboundStock
        const minQty = Number(r.minQuantity)
        const maxQty = Number(r.maxQuantity)
        const multiple = Number(r.quantityMultiple) || 1
        const isBelowMin = virtualStock < minQty
        const suggestedOrderQty = isBelowMin
          ? Math.ceil(Math.max(0, maxQty - virtualStock) / multiple) * multiple
          : 0

        return {
          id: r.id,
          productId: r.productId,
          warehouseId: r.warehouseId,
          minQuantity: r.minQuantity,
          maxQuantity: r.maxQuantity,
          quantityMultiple: r.quantityMultiple,
          preferredVendorId: r.preferredVendorId,
          isActive: r.isActive,
          inboundStock,
          virtualStock,
          isBelowMin,
          suggestedOrderQty,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }
      }),
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
    const parsed = reorderingRuleCreateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 422 }
      )
    }

    const now = new Date()
    const rule = ctx.em.create(ReorderingRule, {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      productId: parsed.data.productId,
      warehouseId: parsed.data.warehouseId ?? null,
      minQuantity: Number(parsed.data.minQuantity).toFixed(4),
      maxQuantity: Number(parsed.data.maxQuantity).toFixed(4),
      quantityMultiple: Number(parsed.data.quantityMultiple).toFixed(4),
      preferredVendorId: parsed.data.preferredVendorId ?? null,
      isActive: parsed.data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })

    await ctx.em.persist(rule).flush()

    return NextResponse.json({ item: rule }, { status: 201 })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
