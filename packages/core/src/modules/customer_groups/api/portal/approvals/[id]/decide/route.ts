import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { customerPurchaseApprovalDecideRequestSchema } from '../../../../../data/validators'
import { resolvePortalApprovalContext } from '../../../../../lib/portalApprovalAuth'
import { isApprovalVisibleToPortalPrincipal } from '../../../../../lib/portalApprovalAccess'
import { mapApprovalServiceError } from '../../../../../lib/approvalErrors'

const logger = createLogger('customer_groups')

export const metadata = {
  POST: { requireAuth: false },
}

const APPROVAL_RESOURCE_KIND = 'customer_groups:customer_purchase_approval'

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// Release 5 Phase 4 (Step 2.6, G5/§9/§9.2). `POST .../portal/approvals/:id/decide`
// decides the BUYER slot — the deciding actor is always `{ actorType: 'customer_user',
// actorId: auth.sub, customerEntityId: auth.customerEntityId }`, taken from the
// authenticated portal session, never from the request body. `decideApproval`
// (Step 2.5) defensively re-derives the actor's real company from
// `customer_accounts.CustomerUser` by id and 404s on a mismatch — this route's own
// `isApprovalVisibleToPortalPrincipal` check is a cheap first layer, the service's
// check is the authority (defense in depth, same reasoning as Step 2.5's G24 note).
export async function POST(req: Request, routeContext: RouteContext) {
  const { translate } = await resolveTranslations()
  const approvalNotFound = () =>
    NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.approvalNotFound', 'Purchase approval not found.') },
      { status: 404 },
    )
  try {
    const params = paramsSchema.safeParse(await routeContext.params)
    if (!params.success) return approvalNotFound()

    const contextOrResponse = await resolvePortalApprovalContext(req, 'customer_groups.portal.approvals.decide')
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse

    const scope = { tenantId: context.principal.tenantId, organizationId: context.principal.organizationId }
    const current = await context.approvalService.getApproval({ scope, approvalId: params.data.id })
    if (!current || !isApprovalVisibleToPortalPrincipal(context.principal, current)) return approvalNotFound()

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const parsedBody = customerPurchaseApprovalDecideRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json(
        { ok: false, error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }

    enforceCommandOptimisticLock({
      resourceKind: APPROVAL_RESOURCE_KIND,
      resourceId: current.id,
      current: current.updatedAt,
      request: req,
    })

    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.auth.sub,
        tenantId: context.principal.tenantId,
        organizationId: context.principal.organizationId,
        // A portal `customer_user` is not known to the staff `rbacService` guards
        // resolve by default — same convention as `warranty_claims`'s portal create
        // guard (`runPortalCreateGuard`) to avoid a meaningless feature lookup.
        userFeatures: [],
      },
      input: {
        resourceKind: APPROVAL_RESOURCE_KIND,
        resourceId: current.id,
        operation: 'update',
        mutationPayload: parsedBody.data,
      },
    })
    if (!guarded.ok) return guarded.response

    const updated = await context.approvalService.decideApproval({
      scope,
      approvalId: current.id,
      decision: parsedBody.data.decision,
      actor: {
        actorType: 'customer_user',
        actorId: context.auth.sub,
        customerEntityId: context.principal.customerEntityId,
      },
      note: parsedBody.data.note,
    })

    await guarded.runAfterSuccess()

    return NextResponse.json({ item: updated })
  } catch (err) {
    const mapped = mapApprovalServiceError(err, translate)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.portal.approvals.decide failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.portal_approvals_decide_failed' })
    return NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.approvalDecideFailed', 'Failed to record the approval decision.') },
      { status: 500 },
    )
  }
}

const decideResponseSchema = z.object({
  item: z
    .object({
      id: z.string().uuid(),
      status: z.enum(['pending', 'approved', 'rejected', 'expired', 'withdrawn']),
    })
    .passthrough(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups Portal',
  summary: 'Decide a purchase approval (buyer side)',
  methods: {
    POST: {
      summary: 'Record the buyer-side decision on a purchase approval',
      description:
        'Decides the buyer slot of a pending purchase approval via a compare-and-set conditional update (§6.6, Step 2.5). The deciding actor is the authenticated portal session. Supports the optimistic-lock header; a stale write 409s.',
      requestBody: { contentType: 'application/json', schema: customerPurchaseApprovalDecideRequestSchema },
      responses: [{ status: 200, description: 'The updated approval', schema: decideResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body', schema: errorSchema },
        { status: 401, description: 'Not signed in to the portal', schema: errorSchema },
        { status: 403, description: 'No company association, missing the decide feature, or self-decision', schema: errorSchema },
        { status: 404, description: 'Not found, or belongs to another company', schema: errorSchema },
        { status: 409, description: 'Optimistic-lock conflict, or the request is no longer pending', schema: errorSchema },
        { status: 500, description: 'Unexpected failure', schema: errorSchema },
      ],
    },
  },
}
