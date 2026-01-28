import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Workflows Module Events
 *
 * Declares all events that can be emitted by the workflows module.
 */
const events = [
  // Workflow Definitions
  { id: 'workflows.definitions.created', label: 'Workflow Definition Created', entity: 'definitions', category: 'crud' },
  { id: 'workflows.definitions.updated', label: 'Workflow Definition Updated', entity: 'definitions', category: 'crud' },
  { id: 'workflows.definitions.deleted', label: 'Workflow Definition Deleted', entity: 'definitions', category: 'crud' },

  // Workflow Instances
  { id: 'workflows.instances.created', label: 'Workflow Instance Created', entity: 'instances', category: 'crud' },
  { id: 'workflows.instances.updated', label: 'Workflow Instance Updated', entity: 'instances', category: 'crud' },
  { id: 'workflows.instances.deleted', label: 'Workflow Instance Deleted', entity: 'instances', category: 'crud' },

  // Workflow Lifecycle Events
  { id: 'workflows.instance.started', label: 'Workflow Started', category: 'lifecycle' },
  { id: 'workflows.instance.completed', label: 'Workflow Completed', category: 'lifecycle' },
  { id: 'workflows.instance.failed', label: 'Workflow Failed', category: 'lifecycle' },
  { id: 'workflows.instance.cancelled', label: 'Workflow Cancelled', category: 'lifecycle' },
  { id: 'workflows.instance.paused', label: 'Workflow Paused', category: 'lifecycle' },
  { id: 'workflows.instance.resumed', label: 'Workflow Resumed', category: 'lifecycle' },

  // Activity Events
  { id: 'workflows.activity.started', label: 'Activity Started', category: 'lifecycle' },
  { id: 'workflows.activity.completed', label: 'Activity Completed', category: 'lifecycle' },
  { id: 'workflows.activity.failed', label: 'Activity Failed', category: 'lifecycle' },

  // Event Triggers
  { id: 'workflows.triggers.created', label: 'Trigger Created', entity: 'triggers', category: 'crud' },
  { id: 'workflows.triggers.updated', label: 'Trigger Updated', entity: 'triggers', category: 'crud' },
  { id: 'workflows.triggers.deleted', label: 'Trigger Deleted', entity: 'triggers', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'workflows',
  events,
})

/** Type-safe event emitter for workflows module */
export const emitWorkflowsEvent = eventsConfig.emit

/** Event IDs that can be emitted by the workflows module */
export type WorkflowsEventId = typeof events[number]['id']

export default eventsConfig
