import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Workflows Module Events
 *
 * Declares all events that can be emitted by the workflows module.
 */
const events = [
  // Workflow Definitions
  { id: 'workflows.definition.created', label: 'Workflow Definition Created', entity: 'definition', category: 'crud' },
  { id: 'workflows.definition.updated', label: 'Workflow Definition Updated', entity: 'definition', category: 'crud' },
  { id: 'workflows.definition.deleted', label: 'Workflow Definition Deleted', entity: 'definition', category: 'crud' },

  // Workflow Instances
  { id: 'workflows.instance.created', label: 'Workflow Instance Created', entity: 'instance', category: 'crud' },
  { id: 'workflows.instance.updated', label: 'Workflow Instance Updated', entity: 'instance', category: 'crud' },
  { id: 'workflows.instance.deleted', label: 'Workflow Instance Deleted', entity: 'instance', category: 'crud' },

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
  { id: 'workflows.trigger.created', label: 'Trigger Created', entity: 'trigger', category: 'crud' },
  { id: 'workflows.trigger.updated', label: 'Trigger Updated', entity: 'trigger', category: 'crud' },
  { id: 'workflows.trigger.deleted', label: 'Trigger Deleted', entity: 'trigger', category: 'crud' },
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
