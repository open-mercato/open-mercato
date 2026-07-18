import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../../organizationScopeFilter.js'
import { MrpSuggestion } from '../../../../data/entities.js'
import { serializeExport, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.mrp.view'] },
}

// Serializes through the shared `serializeExport`/`escapeCsv`/
// `neutralizeSpreadsheetFormula` pipeline (packages/shared/src/lib/crud/exporters.ts)
// instead of a route-local hand-rolled CSV escape, so future free-text
// columns automatically get the platform's CWE-1236 (CSV/formula injection)
// mitigation rather than needing their own escaping logic.
const EXPORT_COLUMNS: PreparedExport['columns'] = [
  { field: 'id', header: 'id' },
  { field: 'productId', header: 'productId' },
  { field: 'variantId', header: 'variantId' },
  { field: 'qty', header: 'qty' },
  { field: 'uom', header: 'uom' },
  { field: 'dueDate', header: 'dueDate' },
  { field: 'runId', header: 'runId' },
]

/**
 * Task 5.2 — CSV export of open `buy` suggestions (spec decision d: "buy =
 * export/notification"). This is the purchasing team's hand-off artifact;
 * acceptance itself does not trigger the export — a caller (or the
 * notification's "export" action, see `notifications.ts`) fetches this
 * endpoint on demand.
 */
export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const rows = await em.find(
      MrpSuggestion,
      {
        tenantId: ctx.auth?.tenantId,
        organizationId: scopeFilter.organizationId,
        suggestionType: 'buy',
        status: 'open',
        deletedAt: null,
      },
      { orderBy: { dueDate: 'asc' } },
    )

    const prepared: PreparedExport = {
      columns: EXPORT_COLUMNS,
      rows: rows.map((row) => ({
        id: row.id,
        productId: row.productId,
        variantId: row.variantId ?? '',
        qty: row.qty,
        uom: row.uom,
        dueDate: row.dueDate.toISOString().slice(0, 10),
        runId: row.runId,
      })),
    }
    const serialized = serializeExport(prepared, 'csv')

    return new NextResponse(serialized.body, {
      status: 200,
      headers: {
        'Content-Type': serialized.contentType,
        'Content-Disposition': 'attachment; filename="mrp-buy-suggestions.csv"',
      },
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.mrp_export_failed', 'Failed to export MRP buy suggestions.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Export open buy suggestions as CSV',
  methods: {
    GET: {
      operationId: 'exportMrpBuySuggestions',
      summary: 'Export open `buy` MRP suggestions',
      description: 'Returns a CSV of all currently open `buy` suggestions, scoped to the authenticated organization.',
      responses: [{ status: 200, description: 'CSV file', schema: z.string() }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
