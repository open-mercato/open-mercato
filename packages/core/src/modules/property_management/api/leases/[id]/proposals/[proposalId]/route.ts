import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { leaseProposalIdSchema } from '../../../../../data/validators'
import { LEASE_RESOURCE_KIND } from '../../../../../commands/lease'
import { loadPermittedLease } from '../../../../../lib/leaseRecords'
import type { ProposalCloseResult } from '../../../../../commands/lease-proposal'
import { handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../../routeContext'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
}

type RouteContext = { params: Promise<{ id?: string; proposalId?: string }> }

export async function DELETE(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const leaseId = await readRouteParam(routeCtx.params, 'id')
    const proposalId = await readRouteParam(routeCtx.params, 'proposalId')
    if (!leaseId || !proposalId) {
      return NextResponse.json({ error: context.translate('property_management.errors.proposalNotFound', 'Proposal not found.') }, { status: 404 })
    }
    const input = leaseProposalIdSchema.parse({ id: proposalId, leaseId, tenantId: context.tenantId, organizationId: context.organizationId })
    await loadPermittedLease(context.em, { tenantId: context.tenantId, organizationId: context.organizationId }, context.permitted, leaseId)
    const guarded = await runStaffGuard(req, context, { resourceKind: LEASE_RESOURCE_KIND, resourceId: leaseId, operation: 'update', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, ProposalCloseResult>('property_management.lease_proposal.withdraw', { input, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.lease_proposal_withdraw_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Withdraw a lease proposal',
  methods: {
    DELETE: {
      summary: 'Withdraw an open proposal (new lease or extension)',
      description: 'Moves the quote to the canceled status on the queue; a new-lease proposal releases the unit.',
      responses: [
        {
          status: 200,
          description: 'Proposal withdrawn',
          schema: z.object({ ok: z.literal(true), proposalId: z.string().uuid(), leaseId: z.string().uuid(), status: z.string(), changed: z.boolean() }),
        },
      ],
      errors: [
        { status: 404, description: 'Proposal not found or its building is not assigned to the caller' },
        { status: 409, description: 'proposal_not_open' },
      ],
    },
  },
}
