import { isDeepStrictEqual } from 'node:util'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import type { WarrantyClaimScope } from '../commands/shared'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export async function isInitialReplacementOrderApproval(
  ctx: CommandRuntimeContext,
  scope: WarrantyClaimScope,
  orderId: string,
  savedVersion: string,
  currentVersion: string,
): Promise<boolean> {
  let logs: ActionLogService
  try {
    logs = ctx.container.resolve<ActionLogService>('actionLogService')
  } catch {
    return false
  }
  if (!logs) return false
  const history = await logs.list({
    ...scope,
    resourceKind: 'sales.order',
    resourceId: orderId,
    includeRelated: true,
    after: new Date(savedVersion),
    pageSize: 3,
  })
  if (history.total > 3 || history.items.length !== history.total) return false
  const edits = history.items.filter((entry) => !(entry.commandId === 'sales.orders.create'
    && entry.resourceKind === 'sales.order' && entry.resourceId === orderId
    && entry.tenantId === scope.tenantId && entry.organizationId === scope.organizationId))
  if (edits.length !== 1) return false
  const entry = edits[0]
  if (entry.commandId !== 'sales.orders.update' || entry.executionState !== 'done') return false
  if (entry.tenantId !== scope.tenantId || entry.organizationId !== scope.organizationId
    || entry.resourceKind !== 'sales.order' || entry.resourceId !== orderId) return false
  const before = record(entry.snapshotBefore)
  const after = record(entry.snapshotAfter)
  const beforeOrder = record(before?.order)
  const afterOrder = record(after?.order)
  if (!beforeOrder || !afterOrder || beforeOrder.id !== orderId || afterOrder.id !== orderId) return false
  if (beforeOrder.updatedAt !== savedVersion || afterOrder.updatedAt !== currentVersion) return false
  if (beforeOrder.status !== null || beforeOrder.statusEntryId !== null || afterOrder.status !== 'pending_approval') return false
  const comparableOrder = (order: Record<string, unknown>) => Object.fromEntries(
    Object.entries(order).filter(([key]) => !['status', 'statusEntryId', 'updatedAt'].includes(key)),
  )
  if (!isDeepStrictEqual(comparableOrder(beforeOrder), comparableOrder(afterOrder))) return false
  const input = record(record(entry.commandPayload)?.__redoInput)
  if (!input || input.id !== orderId || typeof input.statusEntryId !== 'string'
    || input.statusEntryId !== afterOrder.statusEntryId
    || Object.keys(input).some((key) => !['id', 'statusEntryId'].includes(key))) return false
  const beforeNotes = before?.notes
  const afterNotes = after?.notes
  if (!Array.isArray(beforeNotes) || !Array.isArray(afterNotes) || afterNotes.length !== beforeNotes.length + 1) return false
  if (!beforeNotes.every((note) => afterNotes.some((candidate) => isDeepStrictEqual(note, candidate)))) return false
  return ['lines', 'adjustments', 'addresses', 'tags', 'shipments', 'payments']
    .every((key) => Array.isArray(before?.[key]) && isDeepStrictEqual(before?.[key], after?.[key]))
}
