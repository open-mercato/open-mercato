import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { notificationTypes } from '../../notifications'
import { StaffSupportTicket, StaffTeamMember, StaffTimeProject, StaffTimeTask } from '../../data/entities'
import { resolveAssignmentGraceDaysFromContainer } from '../time-tracking/projectAssignment'
import {
  loadActiveAssignerUserIds,
  notifyProjectWork,
  resolveProjectWorkRecipients,
} from '../time-tracking/workRecipients'

const logger = createLogger('staff').child({ component: 'lib/support/notifications' })

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

export type SupportNotificationKind = 'created' | 'customer_replied'

const TYPE_BY_KIND: Record<SupportNotificationKind, string> = {
  created: 'staff.support_ticket.created',
  customer_replied: 'staff.support_ticket.customer_replied',
}

async function resolveAssigneeUserId(em: EntityManager, task: StaffTimeTask): Promise<string | null> {
  if (!task.assigneeStaffMemberId) return null
  const member = await findOneWithDecryption(
    em,
    StaffTeamMember,
    { id: task.assigneeStaffMemberId, tenantId: task.tenantId, organizationId: task.organizationId, deletedAt: null },
    undefined,
    { tenantId: task.tenantId, organizationId: task.organizationId },
  )
  return member?.userId ?? null
}

/**
 * Notifies staff about a support ticket through the project escalation chain and
 * records the outcome on the ticket: `unnotified_at` is set (earliest value kept)
 * when the chain reached nobody, and cleared when a notification reaches someone.
 * Notifying is best-effort — the ticket or reply that triggered it is never undone.
 */
export async function notifySupportTicket(
  container: ContainerLike,
  input: { taskId: string; tenantId: string; organizationId: string; kind: SupportNotificationKind },
): Promise<{ notifiedCount: number; step: number } | null> {
  const typeDef = notificationTypes.find((type) => type.type === TYPE_BY_KIND[input.kind])
  if (!typeDef) return null
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const em = (container.resolve('em') as EntityManager).fork()
  const task = await em.findOne(StaffTimeTask, { id: input.taskId, ...scope, source: 'portal', deletedAt: null })
  if (!task) return null
  const ticket = await findOneWithDecryption(em, StaffSupportTicket, { taskId: task.id, ...scope, deletedAt: null }, undefined, scope)
  if (!ticket) return null
  const project = await em.findOne(StaffTimeProject, { id: task.timeProjectId, ...scope }, { fields: ['id', 'name'] })
  const graceDays = await resolveAssignmentGraceDaysFromContainer(container, input.tenantId)

  const assigneeUserId = await resolveAssigneeUserId(em, task)
  const audience =
    input.kind === 'created'
      ? [assigneeUserId, ...(await loadActiveAssignerUserIds(em, scope, { timeProjectId: task.timeProjectId, graceDays }))]
      : [assigneeUserId]
  const recipients = await resolveProjectWorkRecipients(em, scope, {
    timeProjectId: task.timeProjectId,
    audienceUserIds: audience,
    graceDays,
  })

  const snapshot = ticket.customerSnapshot ?? {}
  const customerName =
    (typeof snapshot.reporterDisplayName === 'string' && snapshot.reporterDisplayName) ||
    (typeof snapshot.displayName === 'string' && snapshot.displayName) ||
    ''
  const request = ticket.customerRequestSnapshot
  const subject = request && typeof request.subject === 'string' ? request.subject : task.title
  const result = await notifyProjectWork(container, scope, {
    typeDef,
    recipients,
    build: {
      titleVariables: { reference: ticket.supportReference },
      bodyVariables: {
        reference: ticket.supportReference,
        customer: customerName,
        subject,
        category: ticket.categorySnapshot?.label ?? ticket.categoryValue,
        project: project?.name ?? '',
      },
      sourceEntityType: 'staff:staff_time_task',
      sourceEntityId: task.id,
      linkHref: `/backend/staff/time-tracking/support?task=${encodeURIComponent(task.id)}`,
      groupKey: `staff:support-ticket-${input.kind}:${task.id}`,
    },
  })

  const fresh = await findOneWithDecryption(em, StaffSupportTicket, { id: ticket.id, ...scope }, undefined, scope)
  if (fresh) {
    if (result.notifiedCount === 0) {
      if (!fresh.unnotifiedAt) {
        fresh.unnotifiedAt = new Date()
        fresh.updatedAt = new Date()
        await em.flush()
      }
      logger.warn('staff support ticket notification reached nobody', {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        timeProjectId: task.timeProjectId,
        ticketId: ticket.id,
        taskId: task.id,
        eventType: typeDef.type,
        emptyStep: result.step,
      })
    } else if (fresh.unnotifiedAt) {
      fresh.unnotifiedAt = null
      fresh.updatedAt = new Date()
      await em.flush()
    }
  }
  return result
}

/** The ticket got an assignee, so somebody now owns it: clear the "nobody notified" flag. */
export async function clearSupportTicketUnnotified(
  em: EntityManager,
  input: { taskId: string; tenantId: string; organizationId: string },
): Promise<boolean> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const ticket = await findOneWithDecryption(
    em,
    StaffSupportTicket,
    { taskId: input.taskId, ...scope, deletedAt: null, unnotifiedAt: { $ne: null } },
    undefined,
    scope,
  )
  if (!ticket) return false
  ticket.unnotifiedAt = null
  ticket.updatedAt = new Date()
  await em.flush()
  return true
}
