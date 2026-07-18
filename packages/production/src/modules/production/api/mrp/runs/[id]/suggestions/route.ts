import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../../../../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../../../../organizationScopeFilter.js'
import { MrpSuggestion } from '../../../../../data/entities.js'
import { mrpSuggestionListQuerySchema } from '../../../../../data/validators.js'
import { createPagedListResponseSchema } from '../../../../openapi.js'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.mrp.view'] },
}

/**
 * Task 5.2 — suggestions for a single `MrpRun`. Default `status=open`
 * (query default from `mrpSuggestionListQuerySchema`) is the no-noise
 * carry-over contract's other half: rows carried over as `'superseded'`
 * (spec § MRP engine, point 3 / `lib/mrp/persistSuggestions.ts`) never show
 * up here unless a caller explicitly asks for another status.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const resolvedParams = await params
    const runId = resolvedParams?.id
    if (!runId) {
      return NextResponse.json({ error: translate('production.errors.id_required', 'Record id is required') }, { status: 400 })
    }

    const query = mrpSuggestionListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const where: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
      runId,
      status: query.status,
      deletedAt: null,
    }
    if (query.suggestionType) where.suggestionType = query.suggestionType

    const page = query.page
    const pageSize = query.pageSize
    const [items, total] = await em.findAndCount(MrpSuggestion, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      items: items.map((row) => ({
        id: row.id,
        runId: row.runId,
        suggestionType: row.suggestionType,
        productId: row.productId,
        variantId: row.variantId ?? null,
        qty: row.qty,
        uom: row.uom,
        dueDate: row.dueDate.toISOString().slice(0, 10),
        demandSource: row.demandSource ?? null,
        status: row.status,
        carriedFromSuggestionId: row.carriedFromSuggestionId ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json(
      { error: translate('production.errors.mrp_suggestions_list_failed', 'Failed to load MRP suggestions.') },
      { status: 400 },
    )
  }
}

const suggestionSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  suggestionType: z.enum(['make', 'buy', 'reschedule', 'cancel']),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  qty: z.string(),
  uom: z.string(),
  dueDate: z.string(),
  demandSource: z.unknown().nullable(),
  status: z.enum(['open', 'accepted', 'dismissed', 'superseded']),
  carriedFromSuggestionId: z.string().uuid().nullable(),
  createdAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'List MRP suggestions for a run',
  methods: {
    GET: {
      operationId: 'listMrpRunSuggestions',
      summary: 'List MRP suggestions for a run',
      description: 'Returns suggestions for the given run, default `status=open` (carried-over rows are `superseded` and excluded by default).',
      responses: [
        { status: 200, description: 'Suggestions', schema: createPagedListResponseSchema(suggestionSchema) },
      ],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
