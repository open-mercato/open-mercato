import { NextResponse } from 'next/server'
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
import { derivePortalStatus } from '../../../../lib/support/portalStatus'

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

const messageSchema = z.object({
  id: z.string().uuid(),
  authorKind: z.enum(['staff', 'customer']),
  authorName: z.string().nullable(),
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
  messages: z.array(messageSchema),
})

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
        const users = await findWithDecryption(scope.em, User, { id: { $in: staffUserIds } }, undefined, decryptionScope)
        for (const user of users) staffNames.set(user.id, typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null)
      } catch {
        staffNames.clear()
      }
    }
    const request = ticket.customerRequestSnapshot
    const canReply = await scope.hasFeature(PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
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
        messages: comments.map((comment) => ({
          id: comment.id,
          authorKind: comment.authorKind === 'customer' ? 'customer' : 'staff',
          authorName:
            comment.authorKind === 'customer'
              ? comment.authorDisplaySnapshot?.displayName ?? null
              : comment.authorUserId
                ? staffNames.get(comment.authorUserId) ?? null
                : null,
          body: comment.body,
          createdAt: comment.createdAt ? comment.createdAt.toISOString() : null,
        })),
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
        'One ticket owned by the signed-in customer: the original request, the customer-facing status, and customer-visible messages only. Internal notes are never returned. A ticket of another customer answers 404.',
      responses: [{ status: 200, description: 'Ticket', schema: detailSchema }],
      errors: [
        { status: 401, description: 'No portal session' },
        { status: 403, description: 'Missing portal.support_tickets.view' },
        { status: 404, description: 'Not found or not owned by this customer' },
      ],
    },
  },
}
