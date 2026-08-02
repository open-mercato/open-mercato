import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'reference_module.reference_task.created', label: 'Reference task created', entity: 'reference_task', category: 'crud', clientBroadcast: true },
  { id: 'reference_module.reference_task.updated', label: 'Reference task updated', entity: 'reference_task', category: 'crud', clientBroadcast: true },
  { id: 'reference_module.reference_task.deleted', label: 'Reference task deleted', entity: 'reference_task', category: 'crud', clientBroadcast: true },
  { id: 'reference_module.reference_task.restored', label: 'Reference task restored', entity: 'reference_task', category: 'lifecycle', clientBroadcast: true },
  { id: 'reference_module.reference_task.linked', label: 'Reference task linked', entity: 'reference_task_link', category: 'lifecycle', clientBroadcast: true },
  { id: 'reference_module.reference_task.unlinked', label: 'Reference task unlinked', entity: 'reference_task_link', category: 'lifecycle', clientBroadcast: true },
  { id: 'reference_module.import.completed', label: 'Reference task import completed', entity: 'reference_task', category: 'system', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'reference_module', events })
export const emitReferenceModuleEvent = eventsConfig.emit
export type ReferenceModuleEventId = typeof events[number]['id']

export default eventsConfig
