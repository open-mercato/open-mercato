import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { canonicalizeResourceTag, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
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

const CUSTOMER_GROUP_CACHE_RESOURCE = canonicalizeResourceTag('customer_groups.group') ?? 'customer_groups.group'
const CUSTOMER_GROUP_CACHE_ALIASES = [canonicalizeResourceTag('CustomerGroup') ?? 'customer.group']

// A terms write changes the resolved pricing and terms of every member of the group, so
// it flushes the owning group's cache tags (the same tags a group update flushes) and
// announces `customer_groups.terms.updated` for caches keyed on the group or its members.
// Call it only once the write committed.
export async function announceCustomerGroupTermsUpdated(
  container: CrudCtx['container'],
  terms: { id: string; groupId: string; tenantId: string },
): Promise<void> {
  await invalidateCrudCache(
    container,
    CUSTOMER_GROUP_CACHE_RESOURCE,
    { id: terms.groupId, tenantId: terms.tenantId, organizationId: null },
    terms.tenantId,
    'updated',
    CUSTOMER_GROUP_CACHE_ALIASES,
  )
  await emitCustomerGroupsEvent(
    'customer_groups.terms.updated',
    { id: terms.id, groupId: terms.groupId, organizationId: null, tenantId: terms.tenantId },
    { persistent: true, tenantId: terms.tenantId, organizationId: null },
  )
}
