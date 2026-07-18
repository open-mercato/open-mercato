import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { stockReceiveSchema } from '../../../data/validators.js'
import { defaultOkResponseSchema } from '../../openapi.js'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['production.stock.manage'] },
}

/** Manual stock receipt (goods-received-note style, task 2.2). */
export async function POST(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const body = await req.json()
    const input = stockReceiveSchema.parse(body)

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, { movementIds: string[] }>('production.stock.receive', { input, ctx })

    return NextResponse.json({ movementIds: result.movementIds }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json(
      { error: translate('production.errors.stock_receive_failed', 'Failed to receive stock.') },
      { status: 400 },
    )
  }
}

const receiveResponseSchema = z.object({ movementIds: z.array(z.string().uuid()) })

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Receive production stock',
  methods: {
    POST: {
      operationId: 'receiveProductionStock',
      summary: 'Record a manual stock receipt',
      description: 'Records a manual goods-received movement, creating/finding the stock item and optional batch by number.',
      requestBody: { schema: stockReceiveSchema },
      responses: [{ status: 201, description: 'Receipt recorded', schema: receiveResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'UoM mismatch or would go negative', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
