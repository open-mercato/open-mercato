import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerPurchaseApproval } from '../../../data/entities'
import { customerPurchaseApprovalListQuerySchema } from '../../../data/validators'
import { resolveStaffApprovalScope } from '../../../lib/approvalStaffContext'
import { toApprovalView } from '../../../services/customerPurchaseApprovalService'

const logger = createLogger('customer_groups')

// Release 5 Phase 4 (Step 2.6, G5/§9). `GET /api/customer_groups/customer-groups/approvals`
// — organization-scoped list, filterable by `status`/`customerId`/`subjectType`/`ids`.
// There is no `makeCrudRoute` here (same reasoning as the sibling `credit-accounts/
// [id]/ledger` read route): the entity has no create/update/delete surface (decisions
// are service-owned conditional updates, §6.6, Step 2.5), so a hand-written read-only
// route queries the decrypted entity directly and serializes through the SAME
// `toApprovalView` the service itself returns from `getApproval`/`decideApproval`.
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.approvals.view'] },
}

function parseIds(raw: string | undefined): string[] | null {
  if (!raw) return null
  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return ids.length ? ids : null
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const context = await resolveStaffApprovalScope(req, translate)
    if (Array.isArray(context.organizationIds) && context.organizationIds.length === 0) {
      return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 })
    }

    const url = new URL(req.url)
    const query = customerPurchaseApprovalListQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      customerId: url.searchParams.get('customerId') ?? undefined,
      subjectType: url.searchParams.get('subjectType') ?? undefined,
      ids: url.searchParams.get('ids') ?? undefined,
    })
    if (!query.success) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }
    const { page, pageSize, status, customerId, subjectType } = query.data
    const ids = parseIds(query.data.ids)

    const where: Record<string, unknown> = { tenantId: context.tenantId }
    if (Array.isArray(context.organizationIds)) where.organizationId = { $in: context.organizationIds }
    if (status) where.status = status
    if (customerId) where.customerId = customerId
    if (subjectType) where.subjectType = subjectType
    if (ids) where.id = { $in: ids }

    const [rows, total] = await findAndCountWithDecryption(
      context.em,
      CustomerPurchaseApproval,
      where,
      { orderBy: { createdAt: 'desc', id: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize },
      { tenantId: context.tenantId },
    )

    return NextResponse.json({
      items: rows.map(toApprovalView),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.approvals.list failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.approvals_list_failed' })
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

const listResponseSchema = z.object({
  items: z.array(approvalViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'List purchase approvals',
  methods: {
    GET: {
      summary: 'List purchase approvals',
      description:
        'Returns purchase approval requests scoped to the caller’s tenant and organizations, filterable by status, customer, subject type and ids.',
      query: customerPurchaseApprovalListQuerySchema,
      responses: [{ status: 200, description: 'A page of purchase approvals', schema: listResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query or tenant context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 500, description: 'Unexpected failure', schema: errorSchema },
      ],
    },
  },
}
