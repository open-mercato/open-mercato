import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { leaseExtensionBodySchema, leaseExtensionSchema } from '../../../../data/validators'
import { LEASE_RESOURCE_KIND } from '../../../../commands/lease'
import { loadPermittedLease } from '../../../../lib/leaseRecords'
import type { LeaseExtensionResult } from '../../../../commands/lease-extension'
import { guardedCommandInput, handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../routeContext'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) return NextResponse.json({ error: context.translate('property_management.errors.leaseNotFound', 'Lease not found.') }, { status: 404 })
    const body = leaseExtensionBodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const input = leaseExtensionSchema.parse({ ...body, id, tenantId: context.tenantId, organizationId: context.organizationId })
    await loadPermittedLease(context.em, { tenantId: context.tenantId, organizationId: context.organizationId }, context.permitted, id)
    const guarded = await runStaffGuard(req, context, { resourceKind: LEASE_RESOURCE_KIND, resourceId: id, operation: 'update', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(leaseExtensionSchema, guarded, input, { id, tenantId: context.tenantId, organizationId: context.organizationId })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const commandId = commandInput.asProposal ? 'property_management.lease.propose_extension' : 'property_management.lease.extend'
    const { result } = await commandBus.execute<typeof commandInput, LeaseExtensionResult>(commandId, { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json(result, { status: 202 })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.lease_extension_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Extend a lease',
  methods: {
    POST: {
      summary: 'Extend a lease directly or propose an extension',
      description:
        'The extension starts the day after the current term ends. Direct: a pending extension version and a new recurring order on the queue; `ends_on` moves when the order exists. Proposal: a recurring quote on the queue answered in the portal.',
      requestBody: { contentType: 'application/json', schema: leaseExtensionBodySchema },
      responses: [
        {
          status: 202,
          description: 'Extension recorded',
          schema: z.object({
            leaseId: z.string().uuid(),
            versionId: z.string().uuid(),
            proposalId: z.string().uuid().nullable(),
            status: z.enum(['pending', 'sending']),
            operationId: z.string().uuid(),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Lease not found or its building is not assigned to the caller' },
        { status: 409, description: 'lease_proposal_open, lease_change_pending, lease_not_active, lease_overlap, or lease_overlaps_bookings (with at most 100 `blockers` and their total `blockerCount`)' },
        { status: 422, description: 'billing_channel_missing or a proposal that would start before its respond-by date' },
      ],
    },
  },
}
