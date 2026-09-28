import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'customer_groups.group.created', label: 'Customer Group Created', entity: 'group', category: 'crud' },
  { id: 'customer_groups.group.updated', label: 'Customer Group Updated', entity: 'group', category: 'crud' },
  { id: 'customer_groups.group.deleted', label: 'Customer Group Deleted', entity: 'group', category: 'crud' },
  { id: 'customer_groups.membership.added', label: 'Customer Added to Group', entity: 'membership', category: 'crud' },
  { id: 'customer_groups.membership.removed', label: 'Customer Removed from Group', entity: 'membership', category: 'crud' },
  { id: 'customer_groups.membership.expired', label: 'Group Membership Expired', entity: 'membership', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'customer_groups',
  events,
})

export const emitCustomerGroupsEvent = eventsConfig.emit

export type CustomerGroupsEventId = typeof events[number]['id']

export default eventsConfig
