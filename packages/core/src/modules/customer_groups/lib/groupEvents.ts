import { emitCustomerGroupsEvent } from '../events'

export type CustomerGroupLifecycleEventId =
  | 'customer_groups.group.created'
  | 'customer_groups.group.updated'
  | 'customer_groups.group.deleted'

// For group writes that bypass the group CRUD route (drag-reorder, reconcile adopt).
// Emits the exact payload and options that route's `events:` config produces through
// the data engine: `{ id, organizationId, tenantId }`, persistent, with
// `organizationId: null` because the route declares `orgField: null` (groups are
// tenant-scoped), so subscribers cannot tell the two write paths apart.
export async function emitCustomerGroupLifecycleEvent(
  eventId: CustomerGroupLifecycleEventId,
  group: { id: string; tenantId: string },
): Promise<void> {
  await emitCustomerGroupsEvent(
    eventId,
    { id: group.id, organizationId: null, tenantId: group.tenantId },
    { persistent: true, tenantId: group.tenantId, organizationId: null },
  )
}
