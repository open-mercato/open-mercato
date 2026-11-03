import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { notificationTypes } from '../notifications'
import { StaffTeamMember, StaffTimeTask } from '../data/entities'
import { resolveAssignmentGraceDaysFromContainer } from '../lib/time-tracking/projectAssignment'
import { notifyProjectWork, resolveProjectWorkRecipients } from '../lib/time-tracking/workRecipients'

const logger = createLogger('staff').child({ component: 'subscribers/time-task-assignee-notification' })

const RELEASED_TYPE = 'staff.timesheets.time_task.released'
const ASSIGNED_TYPE = 'staff.timesheets.time_task.assigned'

export const metadata = {
  event: 'staff.timesheets.time_task.assignee_changed',
  persistent: true,
  id: 'staff:time-task-assignee-notification',
}

export type TaskAssigneeChangedPayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
  timeProjectId?: string | null
  previousAssigneeStaffMemberId?: string | null
  assigneeStaffMemberId?: string | null
  changeKind?: 'default' | 'claim' | 'release' | 'manual' | null
  actorUserId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export type AssigneeNotificationPlan = 'released' | 'assigned' | null

export function planAssigneeNotification(payload: TaskAssigneeChangedPayload): AssigneeNotificationPlan {
  const kind = payload.changeKind ?? null
  const next = payload.assigneeStaffMemberId ?? null
  if (kind === 'release') return 'released'
  if (kind === 'manual') return next ? 'assigned' : 'released'
  return null
}

export default async function handle(payload: TaskAssigneeChangedPayload, ctx: ResolverContext): Promise<void> {
  try {
    const plan = planAssigneeNotification(payload)
    const taskId = payload.id ?? null
    const tenantId = payload.tenantId ?? null
    const organizationId = payload.organizationId ?? null
    if (!plan || !taskId || !tenantId || !organizationId) return
    const scope = { tenantId, organizationId }
    const em = (ctx.resolve('em') as EntityManager).fork()
    const task = await em.findOne(StaffTimeTask, { id: taskId, tenantId, organizationId, deletedAt: null })
    if (!task) return
    const build = {
      bodyVariables: { reference: task.reference, title: task.title },
      sourceEntityType: 'staff:staff_time_task',
      sourceEntityId: task.id,
      linkHref: `/backend/staff/time-tracking/board?projectId=${encodeURIComponent(task.timeProjectId)}&task=${encodeURIComponent(task.id)}`,
      groupKey: `staff:time-task-${plan}:${task.id}`,
    }

    if (plan === 'assigned') {
      const typeDef = notificationTypes.find((type) => type.type === ASSIGNED_TYPE)
      if (!typeDef || !task.assigneeStaffMemberId) return
      const assignee = await findOneWithDecryption(
        em,
        StaffTeamMember,
        { id: task.assigneeStaffMemberId, tenantId, organizationId, deletedAt: null },
        undefined,
        scope,
      )
      const assigneeUserId = assignee?.userId ?? null
      if (!assigneeUserId || assigneeUserId === (payload.actorUserId ?? null)) return
      await notifyProjectWork(ctx, scope, { typeDef, recipients: { step: 1, userIds: [assigneeUserId] }, build })
      return
    }

    const typeDef = notificationTypes.find((type) => type.type === RELEASED_TYPE)
    if (!typeDef) return
    const graceDays = await resolveAssignmentGraceDaysFromContainer(ctx, tenantId)
    const recipients = await resolveProjectWorkRecipients(em, scope, {
      timeProjectId: task.timeProjectId,
      actorUserId: payload.actorUserId ?? null,
      graceDays,
    })
    const result = await notifyProjectWork(ctx, scope, { typeDef, recipients, build })
    if (result.notifiedCount === 0) {
      logger.warn('staff released-task notification reached nobody', {
        tenantId,
        organizationId,
        timeProjectId: task.timeProjectId,
        taskId: task.id,
        step: result.step,
      })
    }
  } catch (err) {
    logger.error('staff task assignee notification failed', { err, taskId: payload.id ?? null })
    throw err
  }
}
