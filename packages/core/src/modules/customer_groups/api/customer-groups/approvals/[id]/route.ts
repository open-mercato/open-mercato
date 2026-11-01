import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerPurchaseApproval } from '../../../../data/entities'
import { resolveStaffApprovalScope } from '../../../../lib/approvalStaffContext'
import { toApprovalView } from '../../../../services/customerPurchaseApprovalService'

const logger = createLogger('customer_groups')

// Release 5 Phase 4 (Step 2.6, §9). `GET /api/customer_groups/customer-groups/approvals/:id`
// — same feature and organization scope as the list route. An approval outside the
// caller's organizations answers 404, never a 403 that would confirm the id exists.
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.approvals.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function GET(req: Request, routeContext: RouteContext) {
  const { translate } = await resolveTranslations()
  const approvalNotFound = () => notFound(translate('customer_groups.errors.approvalNotFound', 'Purchase approval not found.'))
  try {
    const params = paramsSchema.safeParse(await routeContext.params)
    if (!params.success) throw approvalNotFound()

    const context = await resolveStaffApprovalScope(req, translate)
    if (Array.isArray(context.organizationIds) && context.organizationIds.length === 0) throw approvalNotFound()

    const where: Record<string, unknown> = { id: params.data.id, tenantId: context.tenantId }
    if (Array.isArray(context.organizationIds)) where.organizationId = { $in: context.organizationIds }

    const approval = await findOneWithDecryption(
      context.em,
      CustomerPurchaseApproval,
      where,
      undefined,
      { tenantId: context.tenantId },
    )
    if (!approval) throw approvalNotFound()

    return NextResponse.json({ item: toApprovalView(approval) })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.approvals.get failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.approvals_get_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.approvalListFailed', 'Failed to load purchase approvals.') },
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

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Get a purchase approval',
  methods: {
    GET: {
      summary: 'Get one purchase approval by id',
      responses: [{ status: 200, description: 'The purchase approval', schema: z.object({ item: approvalViewSchema }) }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Purchase approval not found in the caller scope', schema: errorSchema },
        { status: 500, description: 'Unexpected failure', schema: errorSchema },
      ],
    },
  },
}
