import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { mrpSuggestionsBulkActionSchema } from '../../../../data/validators.js'
import type { DismissSuggestionsResult } from '../../../../commands/mrp.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.mrp.manage'],
}

export async function POST(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const body = await req.json()
    const input = mrpSuggestionsBulkActionSchema.parse(body)

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, DismissSuggestionsResult>(
      'production.mrp.dismissSuggestions',
      { input, ctx },
    )

    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json(
      { error: translate('production.errors.mrp_dismiss_failed', 'Failed to dismiss MRP suggestions.') },
      { status: 400 },
    )
  }
}

const dismissResponseSchema = z.object({
  dismissedIds: z.array(z.string().uuid()),
  skippedIds: z.array(z.string().uuid()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Dismiss MRP suggestions',
  methods: {
    POST: {
      operationId: 'dismissMrpSuggestions',
      summary: 'Bulk dismiss MRP suggestions',
      description: 'Dismisses open suggestions. Dismissed suggestions carry over on later runs (no re-emitted noise).',
      requestBody: { schema: mrpSuggestionsBulkActionSchema },
      responses: [{ status: 200, description: 'Dismiss result', schema: dismissResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
