import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FreightTripAbstract, FreightTripAbstractLine, ABSTRACT_LINE_DISPUTE_STATUSES, ABSTRACT_LINE_RESOLUTIONS, RATE_BASES } from '../../../data/entities'

export const metadata = {
  path: '/freight_operations/abstracts/lines',
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
}

/**
 * The lines of one abstract, for the detail screen.
 *
 * The abstract is resolved in scope first, so a line of another tenant's
 * abstract reads as not found rather than as an empty list.
 */
export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('errors.organization_required', 'Organization context is required'),
      })
    }

    const abstractId = new URL(req.url).searchParams.get('id')
    if (!abstractId) {
      throw new CrudHttpError(400, { error: translate('freight_operations.errors.record_id_required', 'Record id is required.') })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const abstract = await em.findOne(FreightTripAbstract, {
      id: abstractId,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!abstract) {
      throw new CrudHttpError(404, { error: translate('freight_operations.errors.abstract_not_found', 'Trip abstract not found.') })
    }

    const lines = await em.find(
      FreightTripAbstractLine,
      { abstract: abstractId, tenantId: auth.tenantId, organizationId, deletedAt: null },
      { orderBy: { lineNumber: 'asc' } },
    )

    const items = lines.map((line) => ({
      id: line.id,
      line_number: line.lineNumber,
      trip_id: line.tripId,
      execution_date: line.executionDate instanceof Date ? line.executionDate.toISOString().slice(0, 10) : String(line.executionDate),
      route_code_snapshot: line.routeCodeSnapshot ?? null,
      origin: line.origin,
      destination: line.destination,
      rate_basis: line.rateBasis,
      quantity: line.quantity,
      unit_price_net: line.unitPriceNet,
      base_amount_net: line.baseAmountNet,
      charges_total_net: line.chargesTotalNet,
      charges_summary: line.chargesSummary ?? null,
      total_net_amount: line.totalNetAmount,
      tax_rate: line.taxRate,
      tax_amount: line.taxAmount,
      total_gross_amount: line.totalGrossAmount,
      currency_code: line.currencyCode,
      description: line.description ?? null,
      is_billable: line.isBillable,
      dispute_status: line.disputeStatus,
      dispute_note: line.disputeNote ?? null,
      disputed_at: line.disputedAt instanceof Date ? line.disputedAt.toISOString() : line.disputedAt ?? null,
      dispute_origin: line.disputeOrigin ?? null,
      resolution: line.resolution ?? null,
      resolution_note: line.resolutionNote ?? null,
      resolved_at: line.resolvedAt instanceof Date ? line.resolvedAt.toISOString() : line.resolvedAt ?? null,
      adjusted_amount_net: line.adjustedAmountNet ?? null,
    }))

    return NextResponse.json({
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
      totalPages: 1,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('freight_operations.errors.abstract_lines_load_failed', 'Unable to load the abstract lines.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Trip abstract lines',
  methods: {
    GET: {
      summary: 'Read the trip lines of one abstract, in line order',
      description: 'Returns every line with its dispute and resolution state, scoped to the caller organization.',
      responses: [
        {
          status: 200,
          description: 'Abstract lines',
          schema: z.object({
            items: z.array(z.object({
              id: z.string().uuid(),
              line_number: z.number(),
              trip_id: z.string().uuid(),
              execution_date: z.string(),
              route_code_snapshot: z.string().nullable(),
              origin: z.string(),
              destination: z.string(),
              rate_basis: z.enum(RATE_BASES),
              quantity: z.string(),
              unit_price_net: z.string(),
              base_amount_net: z.string(),
              charges_total_net: z.string(),
              charges_summary: z.array(z.record(z.string(), z.unknown())).nullable(),
              total_net_amount: z.string(),
              tax_rate: z.string(),
              tax_amount: z.string(),
              total_gross_amount: z.string(),
              currency_code: z.string(),
              description: z.string().nullable(),
              is_billable: z.boolean(),
              dispute_status: z.enum(ABSTRACT_LINE_DISPUTE_STATUSES),
              dispute_note: z.string().nullable(),
              disputed_at: z.string().nullable(),
              dispute_origin: z.enum(['customer_portal', 'staff']).nullable(),
              resolution: z.enum(ABSTRACT_LINE_RESOLUTIONS).nullable(),
              resolution_note: z.string().nullable(),
              resolved_at: z.string().nullable(),
              adjusted_amount_net: z.string().nullable(),
            })),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
            totalPages: z.number(),
          }),
        },
      ],
    },
  },
}
