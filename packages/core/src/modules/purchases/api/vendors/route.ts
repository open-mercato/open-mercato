import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { PurchaseVendor } from '../../data/entities'
import { purchaseVendorCreateSchema } from '../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.vendors.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchases.vendors.manage'] },
}

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  isActive: z.enum(['true', 'false', 'all']).optional(),
  sortField: z.enum(['name', 'code', 'currencyCode', 'createdAt', 'updatedAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const url = new URL(req.url)
    const parsedQuery = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))

    if (!parsedQuery.success) {
      return NextResponse.json({ error: formatZodError(parsedQuery.error) }, { status: 400 })
    }

    const { page, pageSize, search, isActive, sortField, sortDir } = parsedQuery.data

    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    }

    if (isActive === 'true') {
      where.isActive = true
    } else if (isActive === 'false') {
      where.isActive = false
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`
      where.$or = [
        { name: { $ilike: q } },
        { code: { $ilike: q } },
        { email: { $ilike: q } },
        { taxId: { $ilike: q } },
      ]
    }

    const [items, total] = await ctx.em.findAndCount(PurchaseVendor, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { [sortField]: sortDir },
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
    const parsed = purchaseVendorCreateSchema.safeParse(json)

    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const now = new Date()
    const vendor = ctx.em.create(PurchaseVendor, {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      name: parsed.data.name.trim(),
      code: parsed.data.code?.trim() || null,
      email: parsed.data.email?.trim() || null,
      phone: parsed.data.phone?.trim() || null,
      currencyCode: parsed.data.currencyCode || 'PLN',
      paymentTerms: parsed.data.paymentTerms?.trim() || null,
      taxId: parsed.data.taxId?.trim() || null,
      address: parsed.data.address?.trim() || null,
      notes: parsed.data.notes?.trim() || null,
      isActive: parsed.data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })

    ctx.em.persist(vendor)
    await ctx.em.flush()
    return NextResponse.json(vendor, { status: 201 })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
