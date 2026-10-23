import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolvePurchasesApiContext } from '../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['purchases.reordering.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const body = (await readJsonSafe(req)) as {
      ruleId?: string
      productId?: string
      warehouseId?: string
    } | null

    const result = await ctx.reorderingEngine.runReplenishment(
      {
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
      },
      {
        ruleId: body?.ruleId,
        productId: body?.productId,
        warehouseId: body?.warehouseId,
      }
    )

    return NextResponse.json(result)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
