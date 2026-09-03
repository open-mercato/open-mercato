/**
 * `GET /api/staff/portal/time-reports` — EP-50, the customer-facing half of the
 * time-tracking suite.
 *
 * **The ownership check, spelled out, because it is the only thing standing
 * between a client and another client's hours.** Every row this route can return
 * satisfies all four of:
 *
 *   `tenant_id      = auth.tenantId`          (from the customer JWT, never input)
 *   `organization_id= auth.orgId`             (ditto; the portal shell already
 *                                              refuses a URL whose org slug does
 *                                              not resolve to this org)
 *   `customer_id    = auth.customerEntityId`  (the signed-in portal user's own
 *                                              customer entity — the same id
 *                                              `staff_time_reports.customer_id`
 *                                              holds, see `data/extensions.ts`)
 *   `status         = 'closed' AND deleted_at IS NULL`
 *
 * A portal user with no `customerEntityId` is refused with `403` rather than
 * being shown an unscoped list: an unlinked portal account is not a customer, and
 * a null in that column would otherwise match nothing or — worse, in a future
 * refactor — everything.
 *
 * **Money is absent, not blanked.** The response has no rate, cost, amount or
 * currency field in its schema at all. `staff.timesheets.rates.view` is a *staff*
 * feature resolved by `rbacService`; a portal identity is graded by
 * `CustomerRbacService` against the disjoint `portal.*` namespace and can never
 * hold it, so the module's own rule — money is added for a holder and absent for
 * everyone else — resolves to "absent, always" here. Making that structural
 * rather than conditional means no later edit can accidentally open it.
 *
 * Draft reports are invisible. A draft is working material whose entries are not
 * frozen; only a closed report is a statement the business has stood behind.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CustomerAuthContext } from '@open-mercato/shared/modules/customer-auth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  PORTAL_TIME_REPORTS_VIEW_FEATURE,
  portalOwnedReportClause,
} from '../../../lib/time-tracking/portalReports'

const logger = createLogger('staff').child({ component: 'api/portal/time-reports' })

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const reportItemSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  title: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  closedAt: z.string().nullable(),
  totalBillableMinutes: z.number().int(),
  totalNonbillableMinutes: z.number().int(),
})

const errorResponseSchema = z.object({ ok: z.literal(false), error: z.string() })

const listResponseSchema = z.object({
  items: z.array(reportItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

type PortalScope = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  em: EntityManager
}

type ReportRow = {
  id: string
  reference: string
  title: string
  period_from: Date | string
  period_to: Date | string
  closed_at: Date | string | null
  total_billable_minutes: number | string | null
  total_nonbillable_minutes: number | string | null
}

export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, 10)
  return null
}

function toIsoDateTime(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString()
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

export function toMinutes(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

/**
 * Resolves the portal identity through `customer_accounts` with a dynamic import.
 * Staff must stay extractable into its own package, so the module graph carries no
 * static edge to `customer_accounts`; a deployment without the portal installed
 * answers `401` here instead of failing to load.
 */
type CustomerFeatureGuard = (
  auth: CustomerAuthContext,
  features: string[],
  rbac: unknown,
) => Promise<void>

export async function resolvePortalScope(req: Request): Promise<PortalScope | Response> {
  let auth: CustomerAuthContext | null = null
  let requireFeature: CustomerFeatureGuard | null = null
  try {
    const customerAuth = await import('@open-mercato/core/modules/customer_accounts/lib/customerAuth')
    auth = await customerAuth.getCustomerAuthFromRequest(req)
    requireFeature = customerAuth.requireCustomerFeature as unknown as CustomerFeatureGuard
  } catch (err) {
    logger.warn('staff portal time-reports could not resolve customer auth', { err })
    return NextResponse.json({ ok: false, error: 'staff.errors.unauthorized' }, { status: 401 })
  }
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'staff.errors.unauthorized' }, { status: 401 })
  }
  const customerId =
    typeof auth.customerEntityId === 'string' && auth.customerEntityId.trim().length > 0
      ? auth.customerEntityId.trim()
      : null
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'staff.errors.customerAccountNotLinked' }, { status: 403 })
  }

  const container = await createRequestContainer()
  if (requireFeature) {
    try {
      const rbac = container.resolve('customerRbacService')
      await requireFeature(auth, [PORTAL_TIME_REPORTS_VIEW_FEATURE], rbac)
    } catch (response) {
      if (response instanceof Response) return response
      logger.warn('staff portal time-reports feature check failed', { err: response })
      return NextResponse.json({ ok: false, error: 'staff.errors.forbidden' }, { status: 403 })
    }
  }

  return {
    auth,
    customerId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em: (container.resolve('em') as EntityManager).fork(),
  }
}

export async function GET(req: Request) {
  try {
    const scopeOrResponse = await resolvePortalScope(req)
    if (scopeOrResponse instanceof Response) return scopeOrResponse
    const scope = scopeOrResponse

    const url = new URL(req.url)
    const parsedQuery = listQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!parsedQuery.success) {
      return NextResponse.json({ ok: false, error: 'staff.errors.invalidInput' }, { status: 400 })
    }
    const { page, pageSize } = parsedQuery.data

    const connection = scope.em.getConnection()
    const owned = portalOwnedReportClause(scope)
    const countRows = (await connection.execute(
      `SELECT COUNT(*)::bigint AS total FROM staff_time_reports WHERE ${owned.sql}`,
      owned.params,
    )) as Array<{ total: string | number | null }>
    const total = toMinutes(countRows?.[0]?.total)

    const rows = (await connection.execute(
      `
        SELECT id, reference, title, period_from, period_to, closed_at,
               total_billable_minutes, total_nonbillable_minutes
        FROM staff_time_reports
        WHERE ${owned.sql}
        ORDER BY period_from DESC, reference DESC
        LIMIT ? OFFSET ?
      `,
      [...owned.params, pageSize, (page - 1) * pageSize],
    )) as ReportRow[]

    const items = rows
      .map((row) => {
        const periodFrom = toIsoDate(row.period_from)
        const periodTo = toIsoDate(row.period_to)
        if (!periodFrom || !periodTo) return null
        return {
          id: row.id,
          reference: row.reference,
          title: row.title,
          periodFrom,
          periodTo,
          closedAt: toIsoDateTime(row.closed_at),
          totalBillableMinutes: toMinutes(row.total_billable_minutes),
          totalNonbillableMinutes: toMinutes(row.total_nonbillable_minutes),
        }
      })
      .filter((item): item is z.infer<typeof reportItemSchema> => item !== null)

    return NextResponse.json(
      listResponseSchema.parse({
        items,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      }),
    )
  } catch (err) {
    logger.error('staff portal time-reports list failed', { err })
    return NextResponse.json({ ok: false, error: 'staff.errors.internal' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  methods: {
    GET: {
      summary: 'List the signed-in customer\u2019s closed time reports',
      description:
        'Returns the closed, non-deleted `staff_time_reports` rows whose `customer_id` matches the portal session\u2019s own customer entity, inside that session\u2019s tenant and organization. Draft reports are never listed. The response carries hours only \u2014 no rate, cost, amount or currency \u2014 because `staff.timesheets.rates.view` is a staff feature a portal identity cannot hold.',
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Closed reports for the signed-in customer', schema: listResponseSchema }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: errorResponseSchema },
        { status: 403, description: 'The portal account is not linked to a customer', schema: errorResponseSchema },
      ],
    },
  },
}
