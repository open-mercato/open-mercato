import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

export type StatusChangeLogInput = {
  actionLogService: ActionLogService
  resourceKind: 'sales.order' | 'sales.quote'
  resourceId: string
  actionLabel: string
  statusFrom: string | null
  statusTo: string
  actorUserId: string | null
  tenantId: string
  organizationId: string
}

export async function logStatusChange(input: StatusChangeLogInput): Promise<void> {
  await input.actionLogService.log({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    commandId: `status-change-${Date.now()}`,
    actionLabel: input.actionLabel,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    snapshotBefore: { status: input.statusFrom },
    snapshotAfter: { status: input.statusTo },
    context: {
      statusFrom: input.statusFrom,
      statusTo: input.statusTo,
    },
  })
}
