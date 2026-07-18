import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { defaultCreateResponseSchema } from '../../../openapi.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['production.technology.manage'],
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
    const result = (await commandBus.execute('production.boms.copyVersion', { input: { id }, ctx })) as
      | { result?: { id?: string } | null; id?: string }
      | null
    const newId = result?.result?.id ?? result?.id ?? null

    return NextResponse.json({ id: newId }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.bom_copy_version_failed', 'Failed to copy BOM version.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Copy a BOM version',
  methods: {
    POST: {
      operationId: 'copyProductionBomVersion',
      summary: 'Copy a BOM version',
      description: 'Creates a new draft BOM version (next version number) with the same items as the source BOM.',
      responses: [
        { status: 201, description: 'New draft BOM version created', schema: defaultCreateResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'BOM not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
