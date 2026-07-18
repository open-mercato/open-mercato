import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../organizationScopeFilter.js'
import { ProductionReport } from '../../../data/entities.js'
import { analyticsScrapReasonsQuerySchema } from '../../../data/validators.js'
import { aggregateScrapByReason, UNSPECIFIED_SCRAP_REASON } from '../../../lib/reports/scrapByReason.js'

/**
 * Scrap-by-reason aggregation, task 6.1. Groups `ProductionReport.qtyScrap`
 * over an optional `createdAt` date range by `scrapReasonEntryId`, then
 * resolves the human-readable labels in ONE batched `DictionaryEntry`
 * lookup (no N+1 per bucket). Reports with a null reason are bucketed
 * under `UNSPECIFIED_SCRAP_REASON` and labeled via i18n rather than looked
 * up in the dictionary (there is no dictionary row for "no reason given").
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.reports.view'] },
}

export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = analyticsScrapReasonsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const where: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
    }
    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {}
      if (query.dateFrom) createdAt.$gte = query.dateFrom
      if (query.dateTo) createdAt.$lte = query.dateTo
      where.createdAt = createdAt
    }

    const reports = await em.find(ProductionReport, where)

    const aggregates = aggregateScrapByReason(
      reports.map((report) => ({
        scrapReasonEntryId: report.scrapReasonEntryId ?? null,
        qtyScrap: report.qtyScrap,
      })),
    )

    const reasonEntryIds = aggregates
      .map((bucket) => bucket.scrapReasonEntryId)
      .filter((id): id is string => id !== UNSPECIFIED_SCRAP_REASON)

    const entries = reasonEntryIds.length
      ? await em.find(DictionaryEntry, {
          id: { $in: reasonEntryIds },
          tenantId: ctx.auth?.tenantId,
          organizationId: scopeFilter.organizationId,
        })
      : []
    const labelById = new Map(entries.map((entry) => [entry.id, entry.label]))

    const items = aggregates.map((bucket) => ({
      scrapReasonEntryId: bucket.scrapReasonEntryId,
      label:
        bucket.scrapReasonEntryId === UNSPECIFIED_SCRAP_REASON
          ? translate('production.analytics.scrap.unspecified', 'Unspecified')
          : labelById.get(bucket.scrapReasonEntryId) ?? bucket.scrapReasonEntryId,
      qtyScrap: bucket.qtyScrap,
      reportCount: bucket.reportCount,
    }))

    return NextResponse.json({ items })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.analytics_scrap_reasons_failed', 'Failed to load scrap-by-reason report.') },
      { status: 400 },
    )
  }
}

const scrapReasonItemSchema = z.object({
  scrapReasonEntryId: z.string(),
  label: z.string(),
  qtyScrap: z.number(),
  reportCount: z.number(),
})

const scrapReasonsResponseSchema = z.object({ items: z.array(scrapReasonItemSchema) })

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Production analytics — scrap by reason',
  methods: {
    GET: {
      operationId: 'getProductionScrapByReasonReport',
      summary: 'Aggregate scrapped quantity by scrap reason over an optional date range',
      description:
        'Quantity-based MVP report (no valuation). Reports with no assigned scrap reason are grouped under an "unspecified" bucket.',
      responses: [{ status: 200, description: 'Scrap-by-reason report', schema: scrapReasonsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
