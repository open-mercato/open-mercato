import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveProductionActionContext } from '../actionRouteContext.js'
import { resolveOrganizationScopeFilter } from '../organizationScopeFilter.js'
import { ProductionReport, ProductionOrderOperation } from '../../data/entities.js'
import { reportCreateSchema, reportListQuerySchema } from '../../data/validators.js'
import { createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi.js'
import type { ReportCreateResult } from '../../commands/reports.js'

/**
 * Report submission (spec § API Contracts: `POST /api/production/reports`).
 *
 * Feature gate decision (task 4.1, documented since `requireFeatures` is an
 * ALL-of check — there is no OR-of-features mechanism in this codebase, see
 * `packages/shared/src/lib/openapi/generator.ts`'s `requireFeatures` usage
 * and every existing route/`makeSalesLineRoute.ts` call site): this route
 * requires `production.operator.report` ONLY, not
 * `production.reports.manage`. Operators (spec decision e's minimal-feature
 * role) hold `production.operator.report` but NOT `production.reports.manage`
 * (reporting oversight); granting operator.report ALSO to planista/kierownik
 * in `setup.ts` (who already hold `reports.manage`) lets every persona that
 * should be able to submit a report actually reach this route, without
 * inventing an OR-features guard mechanism nobody else in the codebase uses.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['production.reports.view'] },
  POST: { requireAuth: true, requireFeatures: ['production.operator.report'] },
}

export async function GET(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const query = reportListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const scopeFilter = resolveOrganizationScopeFilter({
      organizationIds: ctx.organizationIds,
      selectedOrganizationId: ctx.selectedOrganizationId,
    })

    const where: Record<string, unknown> = {
      tenantId: ctx.auth?.tenantId,
      organizationId: scopeFilter.organizationId,
    }
    if (query.orderOperationId) where.orderOperationId = query.orderOperationId
    // `ProductionReport` only stores `orderOperationId` (no direct `orderId`
    // column — reports are a sub-resource of the OPERATION, which is itself
    // a sub-resource of the order), so filtering "by order" resolves the
    // order's operation ids first, then filters reports by that set.
    if (query.orderId) {
      const operations = await em.find(ProductionOrderOperation, {
        orderId: query.orderId,
        tenantId: ctx.auth?.tenantId,
        organizationId: scopeFilter.organizationId,
        deletedAt: null,
      })
      where.orderOperationId = { $in: operations.map((o) => o.id) }
    }

    const page = query.page
    const pageSize = query.pageSize
    const [reports, total] = await em.findAndCount(ProductionReport, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      items: reports.map((r) => ({
        id: r.id,
        orderOperationId: r.orderOperationId,
        reporterUserId: r.reporterUserId,
        qtyGood: Number(r.qtyGood),
        qtyScrap: Number(r.qtyScrap),
        scrapReasonEntryId: r.scrapReasonEntryId ?? null,
        startedAt: r.startedAt ? r.startedAt.toISOString() : null,
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        reportType: r.reportType,
        reversesReportId: r.reversesReportId ?? null,
        createdAt: r.createdAt.toISOString(),
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
      { error: translate('production.errors.reports_list_failed', 'Failed to load production reports.') },
      { status: 400 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { translate } = await resolveTranslations()
  try {
    const { ctx } = await resolveProductionActionContext(req)
    const body = await req.json()
    const input = reportCreateSchema.parse(body)

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, ReportCreateResult>('production.reports.create', { input, ctx })

    return NextResponse.json({ id: result.id, warnings: result.warnings }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    return NextResponse.json(
      { error: translate('production.errors.report_create_failed', 'Failed to record the production report.') },
      { status: 400 },
    )
  }
}

const warningSchema = z.object({
  materialId: z.string(),
  componentProductId: z.string(),
  variantId: z.string().nullable(),
  qty: z.number(),
  uom: z.string(),
  reason: z.enum(['no_stock_item', 'uom_mismatch', 'insufficient_stock', 'missing_conversion']),
})

const createResponseSchema = z.object({ id: z.string().uuid(), warnings: z.array(warningSchema) })

const reportSchema = z.object({
  id: z.string().uuid(),
  orderOperationId: z.string().uuid(),
  reporterUserId: z.string().uuid(),
  qtyGood: z.number(),
  qtyScrap: z.number(),
  scrapReasonEntryId: z.string().uuid().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  reportType: z.enum(['partial', 'final']),
  reversesReportId: z.string().uuid().nullable(),
  createdAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Production',
  summary: 'Shop-floor production reports',
  methods: {
    GET: {
      operationId: 'listProductionReports',
      summary: 'List production reports for an operation',
      responses: [{ status: 200, description: 'Reports', schema: createPagedListResponseSchema(reportSchema) }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
      ],
    },
    POST: {
      operationId: 'createProductionReport',
      summary: 'Record a partial or final shop-floor production report',
      description:
        'Records a good/scrap quantity report against a reporting-point operation. A final report on the LAST reporting-point operation of the order triggers a finished-goods receipt. Backflush (when enabled per product planning params) never fails the report — stock issues that could not be completed are returned as `warnings`.',
      requestBody: { schema: reportCreateSchema },
      responses: [{ status: 201, description: 'Report recorded', schema: createResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Operation or order not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Aggregate optimistic-lock conflict, or the operation was already finalized', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'Order not active, or the operation is not a reporting point', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

export { defaultOkResponseSchema }
