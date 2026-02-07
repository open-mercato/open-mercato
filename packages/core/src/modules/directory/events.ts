import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Directory Module Events
 *
 * Declares all events that can be emitted by the directory module.
 */
const events = [
  // Tenants
  { id: 'directory.tenant.created', label: 'Tenant Created', entity: 'tenant', category: 'crud' },
  { id: 'directory.tenant.updated', label: 'Tenant Updated', entity: 'tenant', category: 'crud' },
  { id: 'directory.tenant.deleted', label: 'Tenant Deleted', entity: 'tenant', category: 'crud' },

  // Organizations
  { id: 'directory.organization.created', label: 'Organization Created', entity: 'organization', category: 'crud' },
  { id: 'directory.organization.updated', label: 'Organization Updated', entity: 'organization', category: 'crud' },
  { id: 'directory.organization.deleted', label: 'Organization Deleted', entity: 'organization', category: 'crud' },
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
