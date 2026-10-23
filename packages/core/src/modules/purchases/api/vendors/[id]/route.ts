import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PurchaseVendor } from '../../../data/entities'
import { purchaseVendorUpdateSchema } from '../../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.vendors.view'] },
  PUT: { requireAuth: true, requireFeatures: ['purchases.vendors.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['purchases.vendors.manage'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)

    const vendor = await ctx.em.findOne(PurchaseVendor, {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    return NextResponse.json(vendor)
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

    const parsed = purchaseVendorUpdateSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const vendor = await ctx.em.findOne(PurchaseVendor, {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    // Check optimistic lock header if provided
    const expectedUpdatedAt = req.headers.get(OPTIMISTIC_LOCK_HEADER_NAME) || req.headers.get('if-match')
    if (expectedUpdatedAt) {
      const normalizedExpected = expectedUpdatedAt.replace(/^"|"$/g, '')
      if (vendor.updatedAt.toISOString() !== normalizedExpected) {
        return NextResponse.json(
          {
            error: 'Conflict: record has been modified by another request',
            currentUpdatedAt: vendor.updatedAt.toISOString(),
          },
          { status: 409 }
        )
      }
    }

    if (parsed.data.name !== undefined) vendor.name = parsed.data.name.trim()
    if (parsed.data.code !== undefined) vendor.code = parsed.data.code?.trim() || null
    if (parsed.data.email !== undefined) vendor.email = parsed.data.email?.trim() || null
    if (parsed.data.phone !== undefined) vendor.phone = parsed.data.phone?.trim() || null
    if (parsed.data.currencyCode !== undefined) vendor.currencyCode = parsed.data.currencyCode
    if (parsed.data.paymentTerms !== undefined) vendor.paymentTerms = parsed.data.paymentTerms?.trim() || null
    if (parsed.data.taxId !== undefined) vendor.taxId = parsed.data.taxId?.trim() || null
    if (parsed.data.address !== undefined) vendor.address = parsed.data.address?.trim() || null
    if (parsed.data.notes !== undefined) vendor.notes = parsed.data.notes?.trim() || null
    if (parsed.data.isActive !== undefined) vendor.isActive = parsed.data.isActive
    vendor.updatedAt = new Date()

    await ctx.em.flush()
    return NextResponse.json(vendor)
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

    const vendor = await ctx.em.findOne(PurchaseVendor, {
      id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const expectedUpdatedAt = req.headers.get(OPTIMISTIC_LOCK_HEADER_NAME) || req.headers.get('if-match')
    if (expectedUpdatedAt) {
      const normalizedExpected = expectedUpdatedAt.replace(/^"|"$/g, '')
      if (vendor.updatedAt.toISOString() !== normalizedExpected) {
        return NextResponse.json(
          {
            error: 'Conflict: record has been modified by another request',
            currentUpdatedAt: vendor.updatedAt.toISOString(),
          },
          { status: 409 }
        )
      }
    }

    vendor.deletedAt = new Date()
    vendor.updatedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ success: true, id })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
