import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerPurchaseApproval } from '../../../../../data/entities'
import { customerPurchaseApprovalDecideRequestSchema } from '../../../../../data/validators'
import { resolveStaffApprovalScope } from '../../../../../lib/approvalStaffContext'
import { mapApprovalServiceError } from '../../../../../lib/approvalErrors'

const logger = createLogger('customer_groups')

// Release 5 Phase 4 (Step 2.6, §9/§9.2). `POST .../approvals/:id/decide` decides the
// MERCHANT slot — the deciding actor is always `{ actorType: 'staff_user', actorId:
// auth.sub }`, derived from the authenticated staff session, never from the request
// body (root AGENTS.md's "scope from the route edge" rule). `decideApproval`
// (Step 2.5) itself derives the slot from `actor.actorType`, so there is no separate
// `side` input to pass. G24's self-approval guard is enforced by the SERVICE; this
// route only honestly passes the real actor through.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customer_groups.approvals.decide'] },
}

const APPROVAL_RESOURCE_KIND = 'customer_groups:customer_purchase_approval'

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function POST(req: Request, routeContext: RouteContext) {
  const { translate } = await resolveTranslations()
  const approvalNotFound = () => notFound(translate('customer_groups.errors.approvalNotFound', 'Purchase approval not found.'))
  try {
    const params = paramsSchema.safeParse(await routeContext.params)
    if (!params.success) throw approvalNotFound()

    const context = await resolveStaffApprovalScope(req, translate)
    if (Array.isArray(context.organizationIds) && context.organizationIds.length === 0) throw approvalNotFound()

    const where: Record<string, unknown> = { id: params.data.id, tenantId: context.tenantId }
    if (Array.isArray(context.organizationIds)) where.organizationId = { $in: context.organizationIds }
    const current = await findOneWithDecryption(context.em, CustomerPurchaseApproval, where, undefined, { tenantId: context.tenantId })
    if (!current) throw approvalNotFound()

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const parsedBody = customerPurchaseApprovalDecideRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json({ error: translate('customer_groups.errors.invalid_input', 'Invalid input') }, { status: 400 })
    }

    // §5.6: the optimistic-lock header is a UX layer the SERVICE does not read (Step
    // 2.5's own comment on `DecideApprovalInput.expectedUpdatedAt`) — the route is the
    // one place that enforces it, exactly like `terms/route.ts`'s PUT.
    enforceCommandOptimisticLock({
      resourceKind: APPROVAL_RESOURCE_KIND,
      resourceId: current.id,
      current: current.updatedAt,
      request: req,
    })

    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.userId, tenantId: context.tenantId, organizationId: current.organizationId },
      input: {
        resourceKind: APPROVAL_RESOURCE_KIND,
        resourceId: current.id,
        operation: 'update',
        mutationPayload: parsedBody.data,
      },
    })
    if (!guarded.ok) return guarded.response

    const updated = await context.approvalService.decideApproval({
      scope: { tenantId: context.tenantId, organizationId: current.organizationId },
      approvalId: current.id,
      decision: parsedBody.data.decision,
      actor: { actorType: 'staff_user', actorId: context.userId },
      note: parsedBody.data.note,
    })

    await guarded.runAfterSuccess()

    return NextResponse.json({ item: updated })
  } catch (err) {
    const mapped = mapApprovalServiceError(err, translate)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.approvals.decide failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.approvals_decide_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.approvalDecideFailed', 'Failed to record the approval decision.') },
      { status: 500 },
    )
  }
}

const decideResponseSchema = z.object({
  item: z.object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'approved', 'rejected', 'expired', 'withdrawn']),
  }).passthrough(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Decide a purchase approval (merchant side)',
  methods: {
    POST: {
      summary: 'Record the merchant-side decision on a purchase approval',
      description:
        'Decides the merchant slot of a pending purchase approval via a compare-and-set conditional update (§6.6, Step 2.5). The deciding actor is the authenticated staff user. Supports the optimistic-lock header; a stale write 409s.',
      requestBody: { contentType: 'application/json', schema: customerPurchaseApprovalDecideRequestSchema },
      responses: [{ status: 200, description: 'The updated approval', schema: decideResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Insufficient permissions, or the requester cannot decide their own request', schema: errorSchema },
        { status: 404, description: 'Purchase approval not found in the caller scope', schema: errorSchema },
        { status: 409, description: 'Optimistic-lock conflict, or the request is no longer pending', schema: errorSchema },
        { status: 500, description: 'Unexpected failure', schema: errorSchema },
      ],
    },
  },
}
