import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../../actionRouteContext.js'
import { defaultOkResponseSchema } from '../../../../openapi.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.stock.manage'],
}

/**
 * Storno (task 2.2). No optimistic-lock header is required here: the stock
 * ledger is append-only (decision h — movements are never updated in
 * place), so there is no `updated_at` on the resource being mutated for a
 * concurrent-edit race to clobber. The only race this endpoint guards
 * against is a concurrent DOUBLE reversal of the SAME movement, which
 * `StockLedgerService.reverseMovement` handles at the DB-constraint level
 * (`DoubleReversalError`, surfaced here as 409) rather than via a version
 * header.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const resolvedParams = await params
    const movementId = resolvedParams?.id
    if (!movementId) {
      return NextResponse.json({ error: translate('production.errors.id_required', 'Record id is required') }, { status: 400 })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<{ movementId: string }, { movementId: string }>(
      'production.stock.reverseMovement',
      { input: { movementId }, ctx },
    )

    return NextResponse.json({ movementId: result.movementId })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.stock_reverse_failed', 'Failed to reverse stock movement.') },
      { status: 400 },
    )
  }
}

const reverseResponseSchema = z.object({ movementId: z.string().uuid() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Reverse a production stock movement',
  methods: {
    POST: {
      operationId: 'reverseProductionStockMovement',
      summary: 'Storno a stock movement',
      description: 'Creates a compensating movement that reverses the given movement. A movement can only be reversed once.',
      responses: [{ status: 200, description: 'Reversal recorded', schema: reverseResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Movement not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Movement already reversed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
