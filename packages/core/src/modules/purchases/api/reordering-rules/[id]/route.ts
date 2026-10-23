import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { reorderingRuleUpdateSchema } from '../../../data/validators'
import { ReorderingRule } from '../../../data/entities'
import { resolvePurchasesApiContext } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.reordering.view'] },
  PUT: { requireAuth: true, requireFeatures: ['purchases.reordering.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['purchases.reordering.manage'] },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const { id } = await params

    const rule = await ctx.em.findOneOrFail(ReorderingRule, {
      id,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    })

    return NextResponse.json({ item: rule })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const { id } = await params
    const body = await readJsonSafe(req)
    const parsed = reorderingRuleUpdateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues },
        { status: 422 }
      )
    }

    const rule = await ctx.em.findOneOrFail(ReorderingRule, {
      id,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    })

    if (parsed.data.warehouseId !== undefined) rule.warehouseId = parsed.data.warehouseId
    if (parsed.data.minQuantity !== undefined) rule.minQuantity = Number(parsed.data.minQuantity).toFixed(4)
    if (parsed.data.maxQuantity !== undefined) rule.maxQuantity = Number(parsed.data.maxQuantity).toFixed(4)
    if (parsed.data.quantityMultiple !== undefined) rule.quantityMultiple = Number(parsed.data.quantityMultiple).toFixed(4)
    if (parsed.data.preferredVendorId !== undefined) rule.preferredVendorId = parsed.data.preferredVendorId
    if (parsed.data.isActive !== undefined) rule.isActive = parsed.data.isActive

    rule.updatedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ item: rule })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const { id } = await params

    const rule = await ctx.em.findOneOrFail(ReorderingRule, {
      id,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
    })

    rule.deletedAt = new Date()
    await ctx.em.flush()

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
