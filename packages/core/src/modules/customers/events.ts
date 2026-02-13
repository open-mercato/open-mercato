import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Customers Module Events
 *
 * Declares all events that can be emitted by the customers module.
 */
const events = [
  // People
  { id: 'customers.person.created', label: 'Customer (Person) Created', entity: 'person', category: 'crud' },
  { id: 'customers.person.updated', label: 'Customer (Person) Updated', entity: 'person', category: 'crud' },
  { id: 'customers.person.deleted', label: 'Customer (Person) Deleted', entity: 'person', category: 'crud' },

  // Companies
  { id: 'customers.company.created', label: 'Customer (Company) Created', entity: 'company', category: 'crud' },
  { id: 'customers.company.updated', label: 'Customer (Company) Updated', entity: 'company', category: 'crud' },
  { id: 'customers.company.deleted', label: 'Customer (Company) Deleted', entity: 'company', category: 'crud' },

  // Deals
  { id: 'customers.deal.created', label: 'Deal Created', entity: 'deal', category: 'crud' },
  { id: 'customers.deal.updated', label: 'Deal Updated', entity: 'deal', category: 'crud' },
  { id: 'customers.deal.deleted', label: 'Deal Deleted', entity: 'deal', category: 'crud' },

  // Comments
  { id: 'customers.comment.created', label: 'Comment Created', entity: 'comment', category: 'crud' },
  { id: 'customers.comment.updated', label: 'Comment Updated', entity: 'comment', category: 'crud' },
  { id: 'customers.comment.deleted', label: 'Comment Deleted', entity: 'comment', category: 'crud' },

  // Addresses
  { id: 'customers.address.created', label: 'Address Created', entity: 'address', category: 'crud' },
  { id: 'customers.address.updated', label: 'Address Updated', entity: 'address', category: 'crud' },
  { id: 'customers.address.deleted', label: 'Address Deleted', entity: 'address', category: 'crud' },

  // Activities
  { id: 'customers.activity.created', label: 'Activity Created', entity: 'activity', category: 'crud' },
  { id: 'customers.activity.updated', label: 'Activity Updated', entity: 'activity', category: 'crud' },
  { id: 'customers.activity.deleted', label: 'Activity Deleted', entity: 'activity', category: 'crud' },

  // Tags
  { id: 'customers.tag.created', label: 'Tag Created', entity: 'tag', category: 'crud' },
  { id: 'customers.tag.updated', label: 'Tag Updated', entity: 'tag', category: 'crud' },
  { id: 'customers.tag.deleted', label: 'Tag Deleted', entity: 'tag', category: 'crud' },
  { id: 'customers.tag.assigned', label: 'Tag Assigned', entity: 'tag', category: 'crud' },
  { id: 'customers.tag.removed', label: 'Tag Removed', entity: 'tag', category: 'crud' },

  // Todos
  { id: 'customers.todo.created', label: 'Todo Created', entity: 'todo', category: 'crud' },
  { id: 'customers.todo.updated', label: 'Todo Updated', entity: 'todo', category: 'crud' },
  { id: 'customers.todo.deleted', label: 'Todo Deleted', entity: 'todo', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'customers',
  events,
})

/** Type-safe event emitter for customers module */
export const emitCustomersEvent = eventsConfig.emit

/** Event IDs that can be emitted by the customers module */
export type CustomersEventId = typeof events[number]['id']

export default eventsConfig
