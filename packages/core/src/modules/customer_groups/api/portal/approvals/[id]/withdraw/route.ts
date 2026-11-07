import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
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

// Release 5 Phase 4 (Step 2.6, G5/§9/§9.2). `POST .../portal/approvals/:id/withdraw`
// — gated on the same `customer_groups.portal.approvals.view` feature as the reads
// (§9 portal table), with "requester only" enforced by identity, not RBAC.
// `withdrawApproval` (Step 2.5) itself compares the authenticated actor's id/type
// against `requestedByActorType`/`requestedByActorId` and throws
// `approval_withdraw_forbidden` for a non-requester — this route never re-implements
// that check, it only passes the real, session-derived actor through honestly.
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

    const contextOrResponse = await resolvePortalApprovalContext(req, 'customer_groups.portal.approvals.view')
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse

    const scope = { tenantId: context.principal.tenantId, organizationId: context.principal.organizationId }
    const current = await context.approvalService.getApproval({ scope, approvalId: params.data.id })
    if (!current || !isApprovalVisibleToPortalPrincipal(context.principal, current)) return approvalNotFound()

    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: {
        userId: context.auth.sub,
        tenantId: context.principal.tenantId,
        organizationId: context.principal.organizationId,
        userFeatures: [],
      },
      input: {
        resourceKind: APPROVAL_RESOURCE_KIND,
        resourceId: current.id,
        operation: 'update',
        mutationPayload: {},
      },
    })
    if (!guarded.ok) return guarded.response

    const updated = await context.approvalService.withdrawApproval({
      scope,
      approvalId: current.id,
      actor: {
        actorType: 'customer_user',
        actorId: context.auth.sub,
        customerEntityId: context.principal.customerEntityId,
      },
    })

    await guarded.runAfterSuccess()

    return NextResponse.json({ item: updated })
  } catch (err) {
    const mapped = mapApprovalServiceError(err, translate)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.portal.approvals.withdraw failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.portal_approvals_withdraw_failed' })
    return NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.approvalWithdrawFailed', 'Failed to withdraw the approval request.') },
      { status: 500 },
    )
  }
}

const withdrawResponseSchema = z.object({
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
  summary: 'Withdraw a purchase approval request',
  methods: {
    POST: {
      summary: 'Withdraw a pending purchase approval (requester only)',
      responses: [{ status: 200, description: 'The withdrawn approval', schema: withdrawResponseSchema }],
      errors: [
        { status: 401, description: 'Not signed in to the portal', schema: errorSchema },
        { status: 403, description: 'No company association, or the caller is not the requester', schema: errorSchema },
        { status: 404, description: 'Not found, or belongs to another company', schema: errorSchema },
        { status: 409, description: 'The request is no longer pending', schema: errorSchema },
        { status: 500, description: 'Unexpected failure', schema: errorSchema },
      ],
    },
  },
}
