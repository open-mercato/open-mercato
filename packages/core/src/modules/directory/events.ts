import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Directory Module Events
 *
 * Declares all events that can be emitted by the directory module.
 */
const events = [
  // Tenants
  { id: 'directory.tenants.created', label: 'Tenant Created', entity: 'tenants', category: 'crud' },
  { id: 'directory.tenants.updated', label: 'Tenant Updated', entity: 'tenants', category: 'crud' },
  { id: 'directory.tenants.deleted', label: 'Tenant Deleted', entity: 'tenants', category: 'crud' },

  // Organizations
  { id: 'directory.organizations.created', label: 'Organization Created', entity: 'organizations', category: 'crud' },
  { id: 'directory.organizations.updated', label: 'Organization Updated', entity: 'organizations', category: 'crud' },
  { id: 'directory.organizations.deleted', label: 'Organization Deleted', entity: 'organizations', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'directory',
  events,
})

/** Type-safe event emitter for directory module */
export const emitDirectoryEvent = eventsConfig.emit

/** Event IDs that can be emitted by the directory module */
export type DirectoryEventId = typeof events[number]['id']

export default eventsConfig
