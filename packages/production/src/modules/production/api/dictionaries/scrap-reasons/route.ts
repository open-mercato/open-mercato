import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { PRODUCTION_SCRAP_REASON_DICTIONARY_KEY } from '../../../lib/dictionaries.js'

/**
 * Scrap-reason dictionary lookup (task 4.2). Gated on
 * `production.operator.report` — the same feature the report-submission
 * route requires (see doc comment in `api/reports/route.ts`), since this
 * route only feeds the scrap-reason picker inside the report form.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.operator.report'] },
}

export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const tenantId = ctx.auth?.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: translate('production.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const em = ctx.container.resolve<EntityManager>('em')
    const orgScopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const dictionary = await em.findOne(Dictionary, {
      tenantId,
      key: PRODUCTION_SCRAP_REASON_DICTIONARY_KEY,
      ...orgScopeFilter,
      deletedAt: null,
    })

    if (!dictionary) {
      return NextResponse.json(
        { error: translate('production.operator.error.scrap_reasons_missing', 'Scrap reason dictionary is not configured yet.') },
        { status: 404 },
      )
    }

    const entries = await em.find(
      DictionaryEntry,
      { dictionary, tenantId, organizationId: dictionary.organizationId },
      { orderBy: { label: 'asc' } },
    )

    return NextResponse.json({
      id: dictionary.id,
      entries: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        label: entry.label,
        color: entry.color ?? null,
        icon: entry.icon ?? null,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.operator.error.scrap_reasons_load_failed', 'Failed to load scrap reason dictionary.') },
      { status: 400 },
    )
  }
}

const scrapReasonEntrySchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
})

const scrapReasonDictionaryResponseSchema = z.object({
  id: z.string().uuid(),
  entries: z.array(scrapReasonEntrySchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Scrap reason dictionary lookup',
  methods: {
    GET: {
      operationId: 'getProductionScrapReasonDictionary',
      summary: 'Resolve the scrap-reason dictionary for the current organization scope',
      description: 'Returns the `production-scrap-reasons` dictionary entries used by the operator report form scrap-reason picker.',
      responses: [
        { status: 200, description: 'Scrap reason dictionary entries', schema: scrapReasonDictionaryResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Dictionary not configured', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
