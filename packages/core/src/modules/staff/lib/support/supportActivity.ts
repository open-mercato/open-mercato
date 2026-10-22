import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { StaffSupportTicket, StaffTimeTask } from '../../data/entities'
import { emitStaffEvent } from '../../events'

const logger = createLogger('staff').child({ component: 'lib/support/supportActivity' })

export type SupportAttachmentActivityKind = 'attachment_added' | 'attachment_removed'

/**
 * Tells open backoffice screens that a customer changed the files on a ticket.
 * Ids only, like every `activity_recorded` broadcast; a failed publish is
 * reported and never fails the upload or deletion that already happened.
 */
export function emitSupportAttachmentActivity(
  task: Pick<StaffTimeTask, 'id' | 'tenantId' | 'organizationId' | 'timeProjectId'>,
  ticket: Pick<StaffSupportTicket, 'id'>,
  kind: SupportAttachmentActivityKind,
): void {
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
    logger.error('staff support attachment activity emit failed', { err, taskId: task.id })
    getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.support_activity_emit_failed' })
  })
}
