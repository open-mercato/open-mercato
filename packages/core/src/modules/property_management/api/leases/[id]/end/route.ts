import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CANCEL_SETTLEMENT_VALUES, leaseEndBodySchema, leaseEndSchema } from '../../../../data/validators'
import { loadPermittedLease } from '../../../../lib/leaseRecords'
import { defaultRecurrenceReader, loadBilledVersions, memoizeRecurrenceReader, planLeaseEnd } from '../../../../lib/leaseEndPlan'
import { hasCreditPermission } from '../../../../lib/creditPermission'
import { defaultCancelSettlement, isRecurrenceCancelAvailable } from '../../../../lib/salesRecurrence'
import { isIsoDate } from '../../../../lib/leaseTerm'
import { LEASE_RESOURCE_KIND, type LeaseChangeResult } from '../../../../commands/lease'
import { guardedCommandInput, handleRouteError, readRouteParam, resolveStaffContext, runStaffGuard } from '../../../routeContext'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
  POST: { requireAuth: true, requireFeatures: ['property_management.leases.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const previewQuerySchema = z.object({ endsOn: z.string().refine(isIsoDate) })

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) return NextResponse.json({ error: context.translate('property_management.errors.leaseNotFound', 'Lease not found.') }, { status: 404 })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const lease = await loadPermittedLease(context.em, scope, context.permitted, id)
    const query = previewQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const versions = await loadBilledVersions(context.em, scope, lease.id)
    const reader = memoizeRecurrenceReader(defaultRecurrenceReader(context.em, scope))
    const [canCredit, defaultSettlement, cancelAvailable] = await Promise.all([
      hasCreditPermission(context.ctx.container, context.ctx.auth, scope),
      defaultCancelSettlement(context.em, scope),
      isRecurrenceCancelAvailable(),
    ])
    const options = []
    let ordersToCancel = 0
    for (const settlement of CANCEL_SETTLEMENT_VALUES) {
      const plan = await planLeaseEnd(versions, query.endsOn, settlement, reader)
      ordersToCancel = plan.entries.length
      options.push({ settlement, wouldCredit: plan.wouldCredit, allowed: canCredit || !plan.wouldCredit })
    }
    return NextResponse.json({ endsOn: query.endsOn, currentEndsOn: lease.endsOn, defaultSettlement, canCredit, cancelAvailable, ordersToCancel, options })
  } catch (err) {
    return handleRouteError(err, 'property_management.lease_end_preview_failed')
  }
}

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) return NextResponse.json({ error: context.translate('property_management.errors.leaseNotFound', 'Lease not found.') }, { status: 404 })
    const body = leaseEndBodySchema.parse((await readJsonSafe<Record<string, unknown>>(req, {})) ?? {})
    const input = leaseEndSchema.parse({ ...body, id, tenantId: context.tenantId, organizationId: context.organizationId })
    await loadPermittedLease(context.em, { tenantId: context.tenantId, organizationId: context.organizationId }, context.permitted, id)
    const guarded = await runStaffGuard(req, context, { resourceKind: LEASE_RESOURCE_KIND, resourceId: id, operation: 'update', payload: { ...input } })
    if (!guarded.ok) return guarded.response
    const commandInput = guardedCommandInput(leaseEndSchema, guarded, input, { id, tenantId: context.tenantId, organizationId: context.organizationId })
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, LeaseChangeResult>('property_management.lease.end', { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, ...result }, { status: result.pending ? 202 : 200 })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return handleRouteError(err, 'property_management.lease_end_failed')
  }
}

const settlementSchema = z.enum(CANCEL_SETTLEMENT_VALUES)

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'End a lease',
  methods: {
    GET: {
      summary: 'Preview ending a lease',
      description: 'Which settlements would credit an invoice for the given end date, and which of them the caller may choose.',
      query: previewQuerySchema,
      responses: [
        {
          status: 200,
          description: 'End preview',
          schema: z.object({
            endsOn: z.string(),
            currentEndsOn: z.string(),
            defaultSettlement: settlementSchema,
            canCredit: z.boolean(),
            cancelAvailable: z.boolean(),
            ordersToCancel: z.number().int(),
            options: z.array(z.object({ settlement: settlementSchema, wouldCredit: z.boolean(), allowed: z.boolean() })),
          }),
        },
      ],
    },
    POST: {
      summary: 'End a lease early or at term',
      description:
        'Sets the new end and cancels the recurrence of every order reaching past it from the next day with the settlement (default: the organization sales setting). Pending until sales confirms; reverted on a permanent sales refusal.',
      requestBody: { contentType: 'application/json', schema: leaseEndBodySchema },
      responses: [
        { status: 200, description: 'Ended without billing changes', schema: z.object({ ok: z.literal(true), leaseId: z.string(), changeId: z.string().nullable(), pending: z.boolean() }) },
        { status: 202, description: 'Billing update pending', schema: z.object({ ok: z.literal(true), leaseId: z.string(), changeId: z.string().nullable(), pending: z.boolean() }) },
      ],
      errors: [
        { status: 403, description: 'The settlement would credit an invoice and the caller lacks sales.credit_memos.manage' },
        { status: 404, description: 'Lease not found or its building is not assigned to the caller' },
        { status: 409, description: 'lease_end_later_than_current, lease_already_ended, lease_change_pending, lease_not_active, lease_billing_cancel_unavailable (sales cannot cancel recurring orders yet and the end needs a cancellation)' },
        { status: 422, description: 'End before the start date' },
      ],
    },
  },
}
