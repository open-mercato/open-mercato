import { NextResponse } from 'next/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { purchaseSettingsUpdateSchema } from '../../data/validators'
import { resolvePurchasesApiContext, formatZodError } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchases.settings.view'] },
  PUT: { requireAuth: true, requireFeatures: ['purchases.settings.manage'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const settings = await ctx.purchaseOrderService.getSettings({
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
    })
    return NextResponse.json(settings)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await resolvePurchasesApiContext(req)
    const json = await readJsonSafe(req)

    const parsed = purchaseSettingsUpdateSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 })
    }

    const settings = await ctx.purchaseOrderService.getSettings({
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
    })

    settings.approvalThresholdAmount = String(parsed.data.approvalThresholdAmount)
    settings.approvalThresholdCurrency = parsed.data.approvalThresholdCurrency
    settings.doubleValidationEnabled = parsed.data.doubleValidationEnabled
    settings.defaultControlPolicy = parsed.data.defaultControlPolicy
    settings.autoCreateReceiptOnConfirm = parsed.data.autoCreateReceiptOnConfirm
    settings.updatedAt = new Date()

    await ctx.em.flush()

    return NextResponse.json(settings)
  } catch (err: unknown) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
