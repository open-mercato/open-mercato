import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolvePurchasesApiContext, formatZodError } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.orders.view'] },
}

const resolveQuerySchema = z.object({
  vendorId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.coerce.number().positive().default(1),
})

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const url = new URL(req.url)
    const parsed = resolveQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))

    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const { vendorId, productId, quantity } = parsed.data
    const best = await ctx.vendorPricelistService.resolveBestPrice(
      { organizationId: ctx.organizationId, tenantId: ctx.tenantId },
      { vendorId, productId, quantity }
    )

    if (!best) {
      return NextResponse.json({ found: false }, { status: 200 })
    }

    return NextResponse.json({ found: true, ...best })
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
