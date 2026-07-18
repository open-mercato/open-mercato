import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { defaultOkResponseSchema } from '../../../openapi.js'
import type { ReportReverseResult } from '../../../../commands/reports.js'

/**
 * Storno of a shop-floor report (spec § API Contracts: `POST
 * …/reports/[id]/reverse`). Gated by `production.reports.manage` (not
 * `operator.report`) — corrections are a supervisory action (kierownik/
 * planista), not part of the minimal operator surface (spec decision e).
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.reports.manage'],
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
    const { result } = await commandBus.execute<{ id: string }, ReportReverseResult>('production.reports.reverse', {
      input: { id },
      ctx,
    })

    return NextResponse.json({ id: result.id, reversedMovementIds: result.reversedMovementIds })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.report_reverse_failed', 'Failed to reverse the production report.') },
      { status: 400 },
    )
  }
}

const reverseResponseSchema = z.object({ id: z.string().uuid(), reversedMovementIds: z.array(z.string().uuid()) })

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Reverse a production report',
  methods: {
    POST: {
      operationId: 'reverseProductionReport',
      summary: 'Storno a production report',
      description:
        'Creates a compensating report that reverses the given report, storno-ing every stock movement it originated (backflush issues and any finished-goods receipt) and decrementing operation/order/material quantities. A report can only be reversed once, and a compensating report itself cannot be reversed.',
      responses: [{ status: 200, description: 'Reversal recorded', schema: reverseResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Report not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Aggregate optimistic-lock conflict, or the report was already reversed', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'A compensating (storno) report cannot itself be reversed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
