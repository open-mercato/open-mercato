import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { validateReceiptSchema } from '../../../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['purchases.orders.manage'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await resolvePurchasesApiContext(req)
    const json = await readJsonSafe(req)

    const parsed = validateReceiptSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const result = await ctx.purchaseReceiptService.validateReceipt(
      id,
      { organizationId: ctx.organizationId, tenantId: ctx.tenantId },
      parsed.data
    )

    return NextResponse.json(result)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
