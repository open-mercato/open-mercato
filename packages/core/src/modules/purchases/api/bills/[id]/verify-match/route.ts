import { NextResponse } from 'next/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolvePurchasesApiContext } from '../../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['purchases.bills.manage'] },
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id?: string }> | { id?: string } }
) {
  try {
    const rawParams = await params
    const id = rawParams?.id
    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    const ctx = await resolvePurchasesApiContext(req)

    const result = await ctx.threeWayMatchService.verifyMatch(id, {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
