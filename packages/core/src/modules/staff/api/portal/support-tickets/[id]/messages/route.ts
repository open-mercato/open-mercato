import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE,
  loadPortalOwnedTicket,
  resolveCustomerDisplay,
  resolveSupportPortalScope,
} from '../../../../../lib/support/portalTickets'
import {
  SUPPORT_TICKET_RESOURCE_KIND,
  buildPortalCommandContext,
  checkPortalRateLimit,
  portalErrorResponse,
  readPathId,
} from '../../../../../lib/support/portalRoute'
import {
  staffSupportTicketCommandIds,
  type SupportTicketMessageResult,
  type SupportTicketPortalMessageInput,
} from '../../../../../commands/support-tickets'

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

const bodySchema = z.object({ body: z.string().trim().min(1).max(10000) })
const responseSchema = z.object({ ok: z.literal(true), id: z.string().uuid(), reopened: z.boolean() })

export async function POST(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    if (scope instanceof Response) return scope
    const taskId = readPathId(req, /\/support-tickets\/([^/]+)\/messages/)
    const owned = taskId ? await loadPortalOwnedTicket(scope, taskId) : null
    if (!owned) return NextResponse.json({ ok: false, error: 'staff.errors.notFound' }, { status: 404 })
    const limited = await checkPortalRateLimit(scope, 'message')
    if (limited) return limited
    const body = bodySchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))
    const guarded = await runRouteMutationGuards({
      container: scope.container,
      req,
      auth: { userId: scope.auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId, userFeatures: [] },
      input: { resourceKind: SUPPORT_TICKET_RESOURCE_KIND, resourceId: owned.task.id, operation: 'update', mutationPayload: body },
    })
    if (!guarded.ok) return guarded.response
    const effectiveBody = guarded.modifiedPayload ? bodySchema.parse({ ...body, ...guarded.modifiedPayload }) : body
    const customer = await resolveCustomerDisplay(scope)
    const input: SupportTicketPortalMessageInput = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerId: scope.customerId,
      customerUserId: scope.auth.sub,
      customerDisplayName: customer.displayName,
      customerKind: customer.kind,
      reporterDisplayName: scope.auth.displayName ?? null,
      taskId: owned.task.id,
      body: effectiveBody.body,
    }
    const commandBus = scope.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<SupportTicketPortalMessageInput, SupportTicketMessageResult>(
      staffSupportTicketCommandIds.portalMessage,
      { input, ctx: buildPortalCommandContext(scope, req) },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json(responseSchema.parse({ ok: true, id: result.commentId, reopened: result.reopened }), { status: 201 })
  } catch (err) {
    const rejection = getCommandInterceptorHttpRejection(err)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return portalErrorResponse(err, 'staff portal support message POST failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  summary: 'Reply on a support ticket',
  methods: {
    POST: {
      summary: 'Reply on a support ticket',
      description:
        'Adds a customer message to a ticket the signed-in customer owns. Replying on a resolved ticket reopens it (it moves back to the project default column). Rate limited per customer user.',
      requestBody: { contentType: 'application/json', schema: bodySchema },
      responses: [{ status: 201, description: 'Message added', schema: responseSchema }],
      errors: [
        { status: 401, description: 'No portal session' },
        { status: 403, description: 'Missing portal.support_tickets.manage' },
        { status: 404, description: 'Not found or not owned by this customer' },
        { status: 429, description: 'Rate limit exceeded' },
      ],
    },
  },
}
