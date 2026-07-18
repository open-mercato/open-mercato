import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { stockAdjustSchema } from '../../../data/validators.js'
import { defaultOkResponseSchema } from '../../openapi.js'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['production.stock.manage'] },
}

/** Opening-balance load / stock correction (signed qty, task 2.2). */
export async function POST(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const body = await req.json()
    const input = stockAdjustSchema.parse(body)

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, { movementId: string }>('production.stock.adjust', { input, ctx })

    return NextResponse.json({ movementId: result.movementId }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json(
      { error: translate('production.errors.stock_adjust_failed', 'Failed to adjust stock.') },
      { status: 400 },
    )
  }
}

const adjustResponseSchema = z.object({ movementId: z.string().uuid() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Adjust production stock',
  methods: {
    POST: {
      operationId: 'adjustProductionStock',
      summary: 'Record an opening-balance load or stock correction',
      description:
        'Records a signed adjustment movement (positive increases on-hand, negative decreases it). A free-text `reason` is required and recorded in the command audit log; dictionary-backed reasons are a follow-up.',
      requestBody: { schema: stockAdjustSchema },
      responses: [{ status: 201, description: 'Adjustment recorded', schema: adjustResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'UoM mismatch or would go negative', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
