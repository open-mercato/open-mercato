import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'resources.resource.created', label: 'Resource Created', entity: 'resource', category: 'crud' },
  { id: 'resources.resource.updated', label: 'Resource Updated', entity: 'resource', category: 'crud' },
  { id: 'resources.resource.deleted', label: 'Resource Deleted', entity: 'resource', category: 'crud' },
  { id: 'resources.resource_type.created', label: 'Resource Type Created', entity: 'resource_type', category: 'crud' },
  { id: 'resources.resource_type.updated', label: 'Resource Type Updated', entity: 'resource_type', category: 'crud' },
  { id: 'resources.resource_type.deleted', label: 'Resource Type Deleted', entity: 'resource_type', category: 'crud' },
  { id: 'resources.comment.created', label: 'Resource Comment Created', entity: 'comment', category: 'crud' },
  { id: 'resources.comment.updated', label: 'Resource Comment Updated', entity: 'comment', category: 'crud' },
  { id: 'resources.comment.deleted', label: 'Resource Comment Deleted', entity: 'comment', category: 'crud' },
  { id: 'resources.activity.created', label: 'Resource Activity Created', entity: 'activity', category: 'crud' },
  { id: 'resources.activity.updated', label: 'Resource Activity Updated', entity: 'activity', category: 'crud' },
  { id: 'resources.activity.deleted', label: 'Resource Activity Deleted', entity: 'activity', category: 'crud' },
  { id: 'resources.resource_tag_assignment.created', label: 'Resource Tag Assignment Created', entity: 'resource_tag_assignment', category: 'crud' },
  { id: 'resources.resource_tag_assignment.updated', label: 'Resource Tag Assignment Updated', entity: 'resource_tag_assignment', category: 'crud' },
  { id: 'resources.resource_tag_assignment.deleted', label: 'Resource Tag Assignment Deleted', entity: 'resource_tag_assignment', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'resources',
  events,
})

export const emitResourcesEvent = eventsConfig.emit

export type ResourcesEventId = typeof events[number]['id']

export default eventsConfig
