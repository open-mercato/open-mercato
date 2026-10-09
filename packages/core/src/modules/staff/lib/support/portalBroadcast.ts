import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { StaffSupportTicket, StaffTimeTask, StaffTimeTaskComment, StaffTimeTaskStatus } from '../../data/entities'
import { emitStaffEvent } from '../../events'
import { resolvePortalRecipientUserIds } from '../time-tracking/portalRecipients'
import { derivePortalStatus } from './portalStatus'

const logger = createLogger('staff').child({ component: 'lib/support/portalBroadcast' })

export const PORTAL_FANOUT_BATCH_SIZE = 200

type Scope = { tenantId: string; organizationId: string }

export type PortalUpdateKind = 'status' | 'reply'

async function emitPortalUpdate(
  em: EntityManager,
  task: StaffTimeTask,
  ticket: StaffSupportTicket,
  portalStatus: string,
  kind: PortalUpdateKind,
): Promise<boolean> {
  if (!task.customerId) return false
  const recipientUserIds = await resolvePortalRecipientUserIds(em, {
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    customerId: task.customerId,
  })
  if (recipientUserIds.length === 0) return false
  await emitStaffEvent(
    'staff.support_ticket.portal_updated',
    {
      id: task.id,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      ticketId: task.id,
      supportReference: ticket.supportReference,
      portalStatus,
      kind,
      recipientUserIds,
    },
    { persistent: true },
  )
  return true
}

function emitActivity(task: StaffTimeTask, ticket: StaffSupportTicket, kind: 'portal_status'): void {
  void emitStaffEvent(
    'staff.support_ticket.activity_recorded',
    {
      id: ticket.id,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      taskId: task.id,
      projectId: task.timeProjectId,
      kind,
    },
    { persistent: true },
  ).catch((err) => logger.error('staff support activity emit failed', { err, taskId: task.id }))
}

/**
 * Compare-and-publish: re-derive the customer-facing status of a portal ticket and
 * broadcast only when it differs from what the portal was last told. Safe to call
 * on any task event; internal tasks and tasks without a ticket row are ignored.
 */
export async function publishTaskPortalStatus(em: EntityManager, taskId: string, scope: Scope): Promise<boolean> {
  const task = await em.findOne(StaffTimeTask, { id: taskId, ...scope, source: 'portal', deletedAt: null })
  if (!task) return false
  const ticket = await em.findOne(StaffSupportTicket, { taskId: task.id, ...scope, deletedAt: null })
  if (!ticket) return false
  const status = await em.findOne(StaffTimeTaskStatus, { id: task.taskStatusId, ...scope }, { fields: ['id', 'isDefault', 'isDone'] })
  const portalStatus = derivePortalStatus(status)
  if (ticket.portalStatusPublished === portalStatus) return false
  ticket.portalStatusPublished = portalStatus
  ticket.updatedAt = new Date()
  await em.flush()
  await emitPortalUpdate(em, task, ticket, portalStatus, 'status')
  emitActivity(task, ticket, 'portal_status')
  return true
}

/** A status column's `isDone`/`isDefault` flags changed: re-derive every live portal ticket in it, in batches. */
export async function fanOutStatusColumn(em: EntityManager, taskStatusId: string, scope: Scope): Promise<number> {
  let published = 0
  let offset = 0
  for (;;) {
    const tasks = await em.find(
      StaffTimeTask,
      { taskStatusId, ...scope, source: 'portal', deletedAt: null },
      { fields: ['id'], limit: PORTAL_FANOUT_BATCH_SIZE, offset, orderBy: { id: 'asc' } },
    )
    if (tasks.length === 0) break
    for (const task of tasks) {
      if (await publishTaskPortalStatus(em.fork(), task.id, scope)) published += 1
    }
    if (tasks.length < PORTAL_FANOUT_BATCH_SIZE) break
    offset += PORTAL_FANOUT_BATCH_SIZE
  }
  return published
}

/** A customer-visible comment was published, retracted or deleted: tell the ticket's own customer users to refetch. */
export async function publishTicketReply(em: EntityManager, commentId: string, scope: Scope): Promise<boolean> {
  const comment = await em.findOne(StaffTimeTaskComment, { id: commentId, ...scope }, { fields: ['id', 'taskId'] })
  if (!comment) return false
  const task = await em.findOne(StaffTimeTask, { id: comment.taskId, ...scope, source: 'portal', deletedAt: null })
  if (!task) return false
  const ticket = await em.findOne(StaffSupportTicket, { taskId: task.id, ...scope, deletedAt: null })
  if (!ticket) return false
  const status = await em.findOne(StaffTimeTaskStatus, { id: task.taskStatusId, ...scope }, { fields: ['id', 'isDefault', 'isDone'] })
  return emitPortalUpdate(em, task, ticket, derivePortalStatus(status), 'reply')
}

export function readEventScope(payload: { tenantId?: unknown; organizationId?: unknown }): Scope | null {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  return tenantId && organizationId ? { tenantId, organizationId } : null
}
