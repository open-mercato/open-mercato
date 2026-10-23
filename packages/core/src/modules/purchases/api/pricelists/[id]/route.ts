import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { VendorPricelist } from '../../../data/entities'
import { vendorPricelistUpdateSchema } from '../../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
  PUT: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)

    const pricelist = await ctx.em.findOne(
      VendorPricelist,
      { id, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
      { populate: ['items'] }
    )

    if (!pricelist) {
      return NextResponse.json({ error: 'Pricelist not found' }, { status: 404 })
    }

    return NextResponse.json(pricelist)
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

    const parsed = vendorPricelistUpdateSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const expectedUpdatedAt = req.headers.get(OPTIMISTIC_LOCK_HEADER_NAME) || req.headers.get('if-match')
    if (expectedUpdatedAt) {
      const current = await ctx.em.findOne(
        VendorPricelist,
        { id, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
        { fields: ['updatedAt'] }
      )
      if (current && current.updatedAt.toISOString() !== expectedUpdatedAt.replace(/^"|"$/g, '')) {
        return NextResponse.json(
          {
            error: 'Conflict: the pricelist was modified by another transaction',
            code: 'OPTIMISTIC_LOCK_CONFLICT',
            currentUpdatedAt: current.updatedAt.toISOString(),
          },
          { status: 409 }
        )
      }
    }

    const updated = await ctx.vendorPricelistService.updatePricelist(
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
