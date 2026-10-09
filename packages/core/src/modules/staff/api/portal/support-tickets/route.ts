/**
 * `GET|POST /api/staff/portal/support-tickets` — customer portal support intake.
 *
 * Every row is loaded with `portalOwnedTaskWhere` (tenant, organization, the
 * signed-in portal user's own `customerEntityId` on the TASK, `source = 'portal'`,
 * not deleted). The project's customer is never consulted, so tickets from many
 * customers can share one project. Subject and description come from the encrypted
 * `customer_request_snapshot`, never from the staff-editable task text, and the
 * response carries no project, task reference, assignee, internal comment or money.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  StaffSupportTicket,
  StaffTimeTask,
  StaffTimeTaskComment,
  StaffTimeTaskStatus,
} from '../../../data/entities'
import {
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE,
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE,
  portalOwnedTaskWhere,
  resolveCustomerDisplay,
  resolveSupportPortalScope,
} from '../../../lib/support/portalTickets'
import {
  SUPPORT_TICKET_RESOURCE_KIND,
  buildPortalCommandContext,
  checkPortalRateLimit,
  portalErrorResponse,
} from '../../../lib/support/portalRoute'
import { derivePortalStatus } from '../../../lib/support/portalStatus'
import {
  staffSupportTicketCommandIds,
  type SupportTicketCreateFromPortalInput,
  type SupportTicketCreateResult,
} from '../../../commands/support-tickets'

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

const portalStatusSchema = z.enum(['received', 'in_progress', 'resolved'])

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: portalStatusSchema.optional(),
})

const ticketListItemSchema = z.object({
  id: z.string().uuid(),
  supportReference: z.string(),
  subject: z.string(),
  category: z.object({ value: z.string(), label: z.string() }),
  portalStatus: portalStatusSchema,
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
})

const listResponseSchema = z.object({
  items: z.array(ticketListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const createBodySchema = z.object({
  categoryValue: z.string().trim().min(1).max(150),
  subject: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10000),
})

const createResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
  supportReference: z.string(),
})

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

async function statusIdsFor(
  scope: { em: import('@mikro-orm/postgresql').EntityManager; tenantId: string; organizationId: string },
  status: z.infer<typeof portalStatusSchema>,
): Promise<string[]> {
  const where: Record<string, unknown> = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  if (status === 'resolved') where.isDone = true
  else if (status === 'received') Object.assign(where, { isDone: false, isDefault: true })
  else Object.assign(where, { isDone: false, isDefault: false })
  const rows = await scope.em.find(StaffTimeTaskStatus, where, { fields: ['id'] })
  return rows.map((row) => row.id)
}

export async function GET(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    if (scope instanceof Response) return scope
    const url = new URL(req.url)
    const query = listQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const where: Record<string, unknown> = portalOwnedTaskWhere(scope)
    if (query.status) {
      const ids = await statusIdsFor(scope, query.status)
      where.taskStatusId = { $in: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] }
    }
    const [tasks, total] = await scope.em.findAndCount(StaffTimeTask, where, {
      orderBy: { updatedAt: 'desc', id: 'desc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })
    const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const taskIds = tasks.map((task) => task.id)
    const tickets = taskIds.length
      ? await findWithDecryption(
          scope.em,
          StaffSupportTicket,
          { taskId: { $in: taskIds }, ...decryptionScope, deletedAt: null },
          undefined,
          decryptionScope,
        )
      : []
    const ticketByTask = new Map(tickets.map((ticket) => [ticket.taskId, ticket]))
    const statusIds = [...new Set(tasks.map((task) => task.taskStatusId))]
    const statuses = statusIds.length
      ? await scope.em.find(StaffTimeTaskStatus, { id: { $in: statusIds }, ...decryptionScope }, { fields: ['id', 'isDefault', 'isDone'] })
      : []
    const statusById = new Map(statuses.map((status) => [status.id, status]))
    const comments = taskIds.length
      ? await scope.em.find(
          StaffTimeTaskComment,
          { taskId: { $in: taskIds }, ...decryptionScope, visibility: 'customer', deletedAt: null },
          { fields: ['taskId', 'createdAt'] },
        )
      : []
    const lastCommentByTask = new Map<string, Date>()
    for (const comment of comments) {
      const previous = lastCommentByTask.get(comment.taskId)
      if (!previous || comment.createdAt > previous) lastCommentByTask.set(comment.taskId, comment.createdAt)
    }
    const items = tasks.flatMap((task) => {
      const ticket = ticketByTask.get(task.id)
      if (!ticket) return []
      const request = ticket.customerRequestSnapshot
      const lastComment = lastCommentByTask.get(task.id) ?? null
      const lastActivity = lastComment && lastComment > task.createdAt ? lastComment : task.createdAt
      return [
        {
          id: task.id,
          supportReference: ticket.supportReference,
          subject: request && typeof request.subject === 'string' ? request.subject : '',
          category: ticket.categorySnapshot,
          portalStatus: derivePortalStatus(statusById.get(task.taskStatusId) ?? null),
          createdAt: isoOrNull(task.createdAt),
          updatedAt: isoOrNull(task.updatedAt),
          lastActivityAt: isoOrNull(lastActivity),
        },
      ]
    })
    return NextResponse.json(
      listResponseSchema.parse({
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      }),
    )
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support tickets GET failed')
  }
}

export async function POST(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    if (scope instanceof Response) return scope
    const limited = await checkPortalRateLimit(scope, 'create')
    if (limited) return limited
    const body = createBodySchema.parse(await readJsonSafe<Record<string, unknown>>(req, {}))
    const customer = await resolveCustomerDisplay(scope)
    const input: SupportTicketCreateFromPortalInput = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerId: scope.customerId,
      customerUserId: scope.auth.sub,
      customerDisplayName: customer.displayName,
      customerKind: customer.kind,
      reporterDisplayName: scope.auth.displayName ?? null,
      categoryValue: body.categoryValue,
      subject: body.subject,
      description: body.description,
    }
    const guarded = await runRouteMutationGuards({
      container: scope.container,
      req,
      auth: { userId: scope.auth.sub, tenantId: scope.tenantId, organizationId: scope.organizationId, userFeatures: [] },
      input: { resourceKind: SUPPORT_TICKET_RESOURCE_KIND, resourceId: null, operation: 'create', mutationPayload: body },
    })
    if (!guarded.ok) return guarded.response
    const commandBus = scope.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<SupportTicketCreateFromPortalInput, SupportTicketCreateResult>(
      staffSupportTicketCommandIds.createFromPortal,
      { input, ctx: buildPortalCommandContext(scope, req) },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json(
      createResponseSchema.parse({ ok: true, id: result.taskId, supportReference: result.supportReference }),
      { status: 201 },
    )
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support tickets POST failed')
  }
}

const errorSchema = z.object({ ok: z.literal(false).optional(), error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  summary: 'Customer support tickets',
  methods: {
    GET: {
      summary: 'List my support tickets',
      description:
        "Support tickets filed by the signed-in portal user's customer, newest activity first. Status is the customer-facing status derived from the board column (received, in_progress, resolved).",
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Tickets', schema: listResponseSchema }],
      errors: [
        { status: 401, description: 'No portal session', schema: errorSchema },
        { status: 403, description: 'Not linked to a customer, or missing portal.support_tickets.view', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'File a support ticket',
      description:
        'Creates a ticket in the category the customer chose. The category routes to a project (its own rule, else the organization fallback rule); the ticket lands in that project default column. Rate limited per customer user.',
      requestBody: { contentType: 'application/json', schema: createBodySchema },
      responses: [{ status: 201, description: 'Ticket filed', schema: createResponseSchema }],
      errors: [
        { status: 401, description: 'No portal session', schema: errorSchema },
        { status: 403, description: 'Missing portal.support_tickets.manage', schema: errorSchema },
        { status: 409, description: 'Too many tickets were filed at once; resubmit', schema: errorSchema },
        { status: 422, description: 'The category is not available', schema: errorSchema },
        { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
      ],
    },
  },
}
