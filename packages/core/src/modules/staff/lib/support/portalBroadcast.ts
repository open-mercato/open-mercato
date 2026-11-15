import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { StaffSupportTicket, StaffTimeTask, StaffTimeTaskComment, StaffTimeTaskStatus } from '../../data/entities'
import { emitStaffEvent } from '../../events'
import { filterPortalRecipientsByFeatureStrict, resolvePortalRecipientUserIdsStrict } from '../time-tracking/portalRecipients'
import { derivePortalStatus } from './portalStatus'
import { PORTAL_SUPPORT_TICKETS_VIEW_FEATURE } from './portalTickets'

const logger = createLogger('staff').child({ component: 'lib/support/portalBroadcast' })

export const PORTAL_FANOUT_BATCH_SIZE = 200

type Scope = { tenantId: string; organizationId: string }

export type PortalUpdateKind = 'status' | 'reply'

/**
 * `version` names the change being announced (the task version for a status change,
 * the comment for a reply). The portal event bridge drops an event whose payload
 * repeats one seen in the last 500 ms, so two different changes must never produce
 * identical payloads, while two publishers of the same change still collapse.
 *
 * Resolves `true` when the update was emitted and `false` when there is genuinely no
 * one to tell (no customer, no portal users, nobody holding the view feature, or the
 * `customer_accounts` module absent). Any other recipient-lookup failure rejects, so a
 * caller never records a publication that did not happen.
 */
async function emitPortalUpdate(
  em: EntityManager,
  task: StaffTimeTask,
  ticket: StaffSupportTicket,
  portalStatus: string,
  kind: PortalUpdateKind,
  version: string,
): Promise<boolean> {
  if (!task.customerId) return false
  const customerUserIds = await resolvePortalRecipientUserIdsStrict(em, {
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    customerId: task.customerId,
  })
  const recipientUserIds = await filterPortalRecipientsByFeatureStrict(
    em,
    customerUserIds,
    { tenantId: task.tenantId, organizationId: task.organizationId },
    PORTAL_SUPPORT_TICKETS_VIEW_FEATURE,
  )
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
      version,
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
  ).catch((err) => {
    logger.error('staff support activity emit failed', { err, taskId: task.id })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_activity_emit_failed' })
  })
}

/**
 * Compare-and-publish: re-derive the customer-facing status of a portal ticket and
 * broadcast only when it differs from what the portal was last told. Safe to call
 * on any task event; internal tasks and tasks without a ticket row are ignored.
 *
 * `always` skips the comparison for triggers that are a status change by definition.
 * Concurrent publishers (a reopen followed quickly by a resolve) each run on their own
 * fork, so both can read a stale `portalStatusPublished` and skip; the portal refetches
 * the ticket on every event, so publishing after each status change keeps it correct.
 *
 * `portalStatusPublished` advances only after `emitPortalUpdate` settles: an emitted
 * update or a genuinely empty audience. A recipient-lookup or emit failure propagates
 * with the marker untouched, so the persistent fan-out retries and republishes.
 */
export async function publishTaskPortalStatus(
  em: EntityManager,
  taskId: string,
  scope: Scope,
  options: { always?: boolean } = {},
): Promise<boolean> {
  const task = await em.findOne(StaffTimeTask, { id: taskId, ...scope, source: 'portal', deletedAt: null })
  if (!task) return false
  const ticket = await findOneWithDecryption(em, StaffSupportTicket, { taskId: task.id, ...scope, deletedAt: null }, undefined, scope)
  if (!ticket) return false
  const status = await em.findOne(StaffTimeTaskStatus, { id: task.taskStatusId, ...scope }, { fields: ['id', 'isDefault', 'isDone'] })
  const portalStatus = derivePortalStatus(status)
  const unchanged = ticket.portalStatusPublished === portalStatus
  if (unchanged && !options.always) return false
  await emitPortalUpdate(em, task, ticket, portalStatus, 'status', task.updatedAt ? task.updatedAt.toISOString() : task.id)
  if (!unchanged) {
    ticket.portalStatusPublished = portalStatus
    ticket.updatedAt = new Date()
    await em.flush()
  }
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
  const comment = await em.findOne(StaffTimeTaskComment, { id: commentId, ...scope }, { fields: ['id', 'taskId', 'updatedAt'] })
  if (!comment) return false
  const task = await em.findOne(StaffTimeTask, { id: comment.taskId, ...scope, source: 'portal', deletedAt: null })
  if (!task) return false
  const ticket = await findOneWithDecryption(em, StaffSupportTicket, { taskId: task.id, ...scope, deletedAt: null }, undefined, scope)
  if (!ticket) return false
  const status = await em.findOne(StaffTimeTaskStatus, { id: task.taskStatusId, ...scope }, { fields: ['id', 'isDefault', 'isDone'] })
  return emitPortalUpdate(em, task, ticket, derivePortalStatus(status), 'reply', `${comment.id}:${comment.updatedAt ? comment.updatedAt.toISOString() : ''}`)
}

export function readEventScope(payload: { tenantId?: unknown; organizationId?: unknown }): Scope | null {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  return tenantId && organizationId ? { tenantId, organizationId } : null
}
