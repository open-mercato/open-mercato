import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { defaultOkResponseSchema } from '../../../openapi.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.orders.manage'],
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)

    const resolvedParams = await params
    const id = resolvedParams?.id
    if (!id) {
      return NextResponse.json({ error: translate('production.errors.id_required', 'Record id is required') }, { status: 400 })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('production.orders.close', { input: { id }, ctx })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.order_close_failed', 'Failed to close the production order.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Close a production order',
  methods: {
    POST: {
      operationId: 'closeProductionOrder',
      summary: 'Close a completed production order',
      description: 'Transitions a production order from `completed` to `closed` (terminal bookkeeping, spec § Status machine).',
      responses: [
        { status: 200, description: 'Production order closed', schema: defaultOkResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Production order not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Aggregate optimistic-lock conflict', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'Illegal status transition', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
