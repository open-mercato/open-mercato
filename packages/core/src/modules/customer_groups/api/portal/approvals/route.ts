import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerPurchaseApproval } from '../../../data/entities'
import { customerPurchaseApprovalPortalListQuerySchema } from '../../../data/validators'
import { resolvePortalApprovalContext } from '../../../lib/portalApprovalAuth'
import { buildPortalApprovalListWhere } from '../../../lib/portalApprovalAccess'
import type { PortalApprovalPrincipal } from '../../../lib/portalApprovalAccess'
import { toApprovalView } from '../../../services/customerPurchaseApprovalService'

type PortalApprovalIdPage = { ids: string[]; total: number }

// Pending-first (§9 portal table) is a rank a plain MikroORM `orderBy` cannot express
// over one column, and `status` itself sorts alphabetically (approved, expired,
// pending, rejected, withdrawn) — NOT pending-first — so an `orderBy` on the column
// alone would be silently wrong. Loads the caller's matching rows through the SAME
// `buildPortalApprovalListWhere` the authorization rule is defined in once
// (`lib/portalApprovalAccess.ts` — never a second, drifting copy of that `WHERE`), ranks
// and paginates in memory, and returns only ids; encrypted fields
// (`buyer_decision_note`/`merchant_decision_note`, G22) are never read off these rows —
// the caller re-reads only the page's ids through `findWithDecryption` for the actual
// response.
async function loadPortalApprovalIdPage(
  em: import('@mikro-orm/postgresql').EntityManager,
  principal: PortalApprovalPrincipal,
  page: number,
  pageSize: number,
): Promise<PortalApprovalIdPage> {
  const where = buildPortalApprovalListWhere(principal)
  const rows = await em.find(CustomerPurchaseApproval, where)
  const sorted = [...rows].sort((a, b) => {
    const pendingRank = (row: CustomerPurchaseApproval) => (row.status === 'pending' ? 0 : 1)
    const rankDiff = pendingRank(a) - pendingRank(b)
    if (rankDiff !== 0) return rankDiff
    const createdDiff = b.createdAt.getTime() - a.createdAt.getTime()
    if (createdDiff !== 0) return createdDiff
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
  const offset = (page - 1) * pageSize
  return { ids: sorted.slice(offset, offset + pageSize).map((row) => row.id), total: sorted.length }
}

const logger = createLogger('customer_groups')

export const metadata = {
  GET: { requireAuth: false },
}

// Release 5 Phase 4 (Step 2.6, G5/§9 portal table). `GET /api/customer_groups/portal/
// approvals` — the buyer-facing approval API this release's API-only selling model
// needs. Holders of `customer_groups.portal.approvals.decide` see their company's
// requests; everyone else sees only requests they made themselves (the `WHERE` built
// by `loadPortalApprovalIdPage` above). Pending first, then newest first, `pageSize ≤
// 100`. Decision notes are still decrypted — `loadPortalApprovalIdPage` only ranks and
// paginates to find the page's ids; the actual response rows come back through
// `findWithDecryption` (G22).
export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const contextOrResponse = await resolvePortalApprovalContext(req, 'customer_groups.portal.approvals.view')
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse

    const url = new URL(req.url)
    const query = customerPurchaseApprovalPortalListQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!query.success) {
      return NextResponse.json(
        { ok: false, error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }
    const { page, pageSize } = query.data
    const { ids, total } = await loadPortalApprovalIdPage(context.em, context.principal, page, pageSize)

    let items: ReturnType<typeof toApprovalView>[] = []
    if (ids.length) {
      const rows = await findWithDecryption(
        context.em,
        CustomerPurchaseApproval,
        { id: { $in: ids }, tenantId: context.principal.tenantId },
        undefined,
        { tenantId: context.principal.tenantId, organizationId: context.principal.organizationId },
      )
      const byId = new Map(rows.map((row) => [row.id, row]))
      items = ids.map((id) => byId.get(id)).filter((row): row is CustomerPurchaseApproval => Boolean(row)).map(toApprovalView)
    }

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    logger.error('customer_groups.portal.approvals.list failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.portal_approvals_list_failed' })
    return NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.approvalListFailed', 'Failed to load purchase approvals.') },
      { status: 500 },
    )
  }
}

const slotViewSchema = z.object({
  decision: z.enum(['pending', 'approved', 'rejected', 'not_required']),
  decidedBy: z.object({ actorType: z.enum(['customer_user', 'staff_user']), actorId: z.string().uuid() }).nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
})

const approvalViewSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  subjectType: z.enum(['cart', 'quote']),
  subjectId: z.string().uuid(),
  amountGross: z.string(),
  currencyCode: z.string(),
  approvalPolicy: z.enum(['buyer', 'merchant', 'both']),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'withdrawn']),
  requestedBy: z.object({ actorType: z.enum(['customer_user', 'staff_user']), actorId: z.string().uuid() }),
  buyer: slotViewSchema,
  merchant: slotViewSchema,
  withdrawnReason: z.enum(['requester', 'cart_merged', 'cart_expired', 'cart_purged']).nullable(),
  decidedAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(approvalViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups Portal',
  summary: 'List the signed-in customer’s purchase approvals',
  methods: {
    GET: {
      summary: 'List purchase approvals visible to the portal session',
      description:
        'Holders of `customer_groups.portal.approvals.decide` see every pending-first request for their own company; everyone else sees only the requests they made themselves.',
      query: customerPurchaseApprovalPortalListQuerySchema,
      responses: [{ status: 200, description: 'A page of purchase approvals', schema: listResponseSchema }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: errorSchema },
        { status: 403, description: 'No company association, or missing the view feature', schema: errorSchema },
      ],
    },
  },
}
