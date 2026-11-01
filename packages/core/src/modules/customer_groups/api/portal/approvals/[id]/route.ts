import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolvePortalApprovalContext } from '../../../../lib/portalApprovalAuth'
import { isApprovalVisibleToPortalPrincipal } from '../../../../lib/portalApprovalAccess'

const logger = createLogger('customer_groups')

export const metadata = {
  GET: { requireAuth: false },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// Release 5 Phase 4 (Step 2.6, G5/§9.2). `GET /api/customer_groups/portal/approvals/:id`
// — same visibility rule as the list. A request for another company's approval
// answers 404, the same body as an unknown id, so the response never discloses that
// the id exists elsewhere (§9.2).
export async function GET(req: Request, routeContext: RouteContext) {
  const { translate } = await resolveTranslations()
  const approvalNotFound = () =>
    NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.approvalNotFound', 'Purchase approval not found.') },
      { status: 404 },
    )
  try {
    const params = paramsSchema.safeParse(await routeContext.params)
    if (!params.success) return approvalNotFound()

    const contextOrResponse = await resolvePortalApprovalContext(req, 'customer_groups.portal.approvals.view')
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse

    const approval = await context.approvalService.getApproval({
      scope: { tenantId: context.principal.tenantId, organizationId: context.principal.organizationId },
      approvalId: params.data.id,
    })
    if (!approval || !isApprovalVisibleToPortalPrincipal(context.principal, approval)) return approvalNotFound()

    return NextResponse.json({ item: approval })
  } catch (err) {
    logger.error('customer_groups.portal.approvals.get failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.portal_approvals_get_failed' })
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

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups Portal',
  summary: 'Get a purchase approval (portal)',
  methods: {
    GET: {
      summary: 'Get one purchase approval visible to the portal session',
      responses: [{ status: 200, description: 'The purchase approval', schema: z.object({ item: approvalViewSchema }) }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: errorSchema },
        { status: 403, description: 'No company association, or missing the view feature', schema: errorSchema },
        { status: 404, description: 'Not found, or belongs to another company', schema: errorSchema },
      ],
    },
  },
}
