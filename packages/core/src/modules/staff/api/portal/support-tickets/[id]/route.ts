import { NextResponse } from 'next/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTimeTaskComment, StaffTimeTaskStatus } from '../../../../data/entities'
import {
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE,
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE,
  loadPortalOwnedTicket,
  resolveSupportPortalScope,
} from '../../../../lib/support/portalTickets'
import { portalErrorResponse, readPathId } from '../../../../lib/support/portalRoute'
import {
  listCustomerVisibleAttachments,
  loadPortalAttachmentsApi,
  portalSupportAttachmentItemSchema,
  type PortalSupportAttachmentItem,
} from '../../../../lib/support/portalAttachments'
import { derivePortalStatus } from '../../../../lib/support/portalStatus'

const logger = createLogger('staff').child({ component: 'api/portal/support-tickets/detail' })

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

const messageSchema = z.object({
  id: z.string().uuid(),
  authorKind: z.enum(['staff', 'customer']),
  authorName: z.string().nullable(),
  isSelf: z.boolean(),
  body: z.string(),
  createdAt: z.string().nullable(),
})

const detailSchema = z.object({
  id: z.string().uuid(),
  supportReference: z.string(),
  subject: z.string(),
  description: z.string(),
  category: z.object({ value: z.string(), label: z.string() }),
  portalStatus: z.enum(['received', 'in_progress', 'resolved']),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  canReply: z.boolean(),
  requester: z.object({ name: z.string().nullable(), isSelf: z.boolean() }),
  messages: z.array(messageSchema),
  attachments: z.array(portalSupportAttachmentItemSchema),
})

function nonEmptyName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function loadVisibleAttachments(
  scope: Parameters<typeof listCustomerVisibleAttachments>[1],
  taskId: string,
  canManage: boolean,
): Promise<PortalSupportAttachmentItem[]> {
  const api = await loadPortalAttachmentsApi()
  if (!api) return []
  try {
    return await listCustomerVisibleAttachments(api, scope, taskId, canManage)
  } catch (err) {
    logger.warn('staff portal support ticket attachments could not be listed', { err, taskId })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_attachments_failed' })
    return []
  }
}

export async function GET(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    if (scope instanceof Response) return scope
    const taskId = readPathId(req, /\/support-tickets\/([^/]+)/)
    const owned = taskId ? await loadPortalOwnedTicket(scope, taskId) : null
    if (!owned) return NextResponse.json({ ok: false, error: 'staff.errors.notFound' }, { status: 404 })
    const { task, ticket } = owned
    const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const status = await scope.em.findOne(StaffTimeTaskStatus, { id: task.taskStatusId, ...decryptionScope }, { fields: ['id', 'isDefault', 'isDone'] })
    const comments = await scope.em.find(
      StaffTimeTaskComment,
      { taskId: task.id, ...decryptionScope, visibility: 'customer', deletedAt: null },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    )
    const staffUserIds = [...new Set(comments.map((comment) => comment.authorUserId).filter((id): id is string => typeof id === 'string'))]
    const staffNames = new Map<string, string | null>()
    if (staffUserIds.length) {
      try {
        const users = await findWithDecryption(
          scope.em,
          User,
          { id: { $in: staffUserIds }, tenantId: scope.tenantId },
          undefined,
          decryptionScope,
        )
        for (const user of users) staffNames.set(user.id, nonEmptyName(user.name))
      } catch (err) {
        logger.warn('staff portal support ticket could not resolve staff names', { err, taskId: task.id })
        getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_staff_names_failed' })
        staffNames.clear()
      }
    }
    const request = ticket.customerRequestSnapshot
    const canReply = await scope.hasFeature(PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    const attachments = await loadVisibleAttachments(scope, task.id, canReply)
    return NextResponse.json(
      detailSchema.parse({
        id: task.id,
        supportReference: ticket.supportReference,
        subject: request && typeof request.subject === 'string' ? request.subject : '',
        description: request && typeof request.body === 'string' ? request.body : '',
        category: ticket.categorySnapshot,
        portalStatus: derivePortalStatus(status),
        createdAt: task.createdAt ? task.createdAt.toISOString() : null,
        updatedAt: task.updatedAt ? task.updatedAt.toISOString() : null,
        canReply,
        requester: {
          name: nonEmptyName(ticket.customerSnapshot?.reporterDisplayName),
          isSelf: ticket.reportedByCustomerUserId === scope.auth.sub,
        },
        messages: comments.map((comment) => ({
          id: comment.id,
          authorKind: comment.authorKind === 'customer' ? 'customer' : 'staff',
          authorName:
            comment.authorKind === 'customer'
              ? nonEmptyName(comment.authorDisplaySnapshot?.displayName)
              : comment.authorUserId
                ? staffNames.get(comment.authorUserId) ?? null
                : null,
          isSelf: comment.authorKind === 'customer' && comment.authorCustomerUserId === scope.auth.sub,
          body: comment.body,
          createdAt: comment.createdAt ? comment.createdAt.toISOString() : null,
        })),
        attachments,
      }),
    )
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support ticket GET failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  summary: 'Support ticket detail',
  methods: {
    GET: {
      summary: 'Support ticket detail',
      description:
        'One ticket owned by the signed-in customer: the original request, the customer-facing status, and customer-visible messages only, and the customer-visible files (`attachments`, same items as the attachments list; an empty list when the attachments module is unavailable). Internal notes and internal files are never returned. A ticket of another customer answers 404.',
      responses: [{ status: 200, description: 'Ticket', schema: detailSchema }],
      errors: [
        { status: 401, description: 'No portal session' },
        { status: 403, description: 'Missing portal.support_tickets.view' },
        { status: 404, description: 'Not found or not owned by this customer' },
      ],
    },
  },
}
