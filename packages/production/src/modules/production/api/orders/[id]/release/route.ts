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
    await commandBus.execute('production.orders.release', { input: { id }, ctx })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.order_release_failed', 'Failed to release the production order.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Release a production order',
  methods: {
    POST: {
      operationId: 'releaseProductionOrder',
      summary: 'Move a planned production order to released',
      description:
        'Transitions a production order from `planned` to `released`, requiring an active BOM+routing version pair for the product/variant. The active BOM items and routing operations are copied into `ProductionOrderMaterial`/`ProductionOrderOperation` as independent snapshot rows (spec decision g) — a later edit to the source BOM/routing never affects an already-released order.',
      responses: [
        { status: 200, description: 'Production order released', schema: defaultOkResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Production order not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Aggregate optimistic-lock conflict', schema: z.object({ error: z.string() }) },
        {
          status: 422,
          description: 'Illegal status transition, or no active BOM/routing version exists for this product',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
