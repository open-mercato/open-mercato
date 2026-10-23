import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { VendorPricelist } from '../../data/entities'
import { vendorPricelistCreateSchema } from '../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  vendorId: z.string().uuid().optional(),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const url = new URL(req.url)
    const parsedQuery = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))

    if (!parsedQuery.success) {
      return NextResponse.json({ error: formatZodError(parsedQuery.error) }, { status: 400 })
    }

    const { page, pageSize, search, vendorId } = parsedQuery.data
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    }

    if (vendorId) where.vendorId = vendorId
    if (search && search.trim()) {
      where.name = { $ilike: `%${search.trim()}%` }
    }

    const [items, total] = await ctx.em.findAndCount(VendorPricelist, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { updatedAt: 'desc' },
      populate: ['items'],
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
    const parsed = vendorPricelistCreateSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const pricelist = await ctx.vendorPricelistService.createPricelist(
      { organizationId: ctx.organizationId, tenantId: ctx.tenantId },
      parsed.data
    )

    return NextResponse.json(pricelist, { status: 201 })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
