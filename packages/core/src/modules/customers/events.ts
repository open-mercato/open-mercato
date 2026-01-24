import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Customers Module Events
 *
 * Declares all events that can be emitted by the customers module.
 */
const events = [
  // People
  { id: 'customers.people.created', label: 'Customer (Person) Created', entity: 'people', category: 'crud' },
  { id: 'customers.people.updated', label: 'Customer (Person) Updated', entity: 'people', category: 'crud' },
  { id: 'customers.people.deleted', label: 'Customer (Person) Deleted', entity: 'people', category: 'crud' },

  // Companies
  { id: 'customers.companies.created', label: 'Customer (Company) Created', entity: 'companies', category: 'crud' },
  { id: 'customers.companies.updated', label: 'Customer (Company) Updated', entity: 'companies', category: 'crud' },
  { id: 'customers.companies.deleted', label: 'Customer (Company) Deleted', entity: 'companies', category: 'crud' },

  // Deals
  { id: 'customers.deals.created', label: 'Deal Created', entity: 'deals', category: 'crud' },
  { id: 'customers.deals.updated', label: 'Deal Updated', entity: 'deals', category: 'crud' },
  { id: 'customers.deals.deleted', label: 'Deal Deleted', entity: 'deals', category: 'crud' },

  // Comments
  { id: 'customers.comments.created', label: 'Comment Created', entity: 'comments', category: 'crud' },
  { id: 'customers.comments.updated', label: 'Comment Updated', entity: 'comments', category: 'crud' },
  { id: 'customers.comments.deleted', label: 'Comment Deleted', entity: 'comments', category: 'crud' },

  // Addresses
  { id: 'customers.addresses.created', label: 'Address Created', entity: 'addresses', category: 'crud' },
  { id: 'customers.addresses.updated', label: 'Address Updated', entity: 'addresses', category: 'crud' },
  { id: 'customers.addresses.deleted', label: 'Address Deleted', entity: 'addresses', category: 'crud' },

  // Activities
  { id: 'customers.activities.created', label: 'Activity Created', entity: 'activities', category: 'crud' },
  { id: 'customers.activities.updated', label: 'Activity Updated', entity: 'activities', category: 'crud' },
  { id: 'customers.activities.deleted', label: 'Activity Deleted', entity: 'activities', category: 'crud' },

  // Tags
  { id: 'customers.tags.created', label: 'Tag Created', entity: 'tags', category: 'crud' },
  { id: 'customers.tags.updated', label: 'Tag Updated', entity: 'tags', category: 'crud' },
  { id: 'customers.tags.deleted', label: 'Tag Deleted', entity: 'tags', category: 'crud' },
  { id: 'customers.tags.assigned', label: 'Tag Assigned', entity: 'tags', category: 'crud' },
  { id: 'customers.tags.removed', label: 'Tag Removed', entity: 'tags', category: 'crud' },

  // Todos
  { id: 'customers.todos.created', label: 'Todo Created', entity: 'todos', category: 'crud' },
  { id: 'customers.todos.updated', label: 'Todo Updated', entity: 'todos', category: 'crud' },
  { id: 'customers.todos.deleted', label: 'Todo Deleted', entity: 'todos', category: 'crud' },
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
