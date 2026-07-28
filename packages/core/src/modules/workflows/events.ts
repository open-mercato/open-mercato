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
  { id: 'workflows.definition.customized', label: 'Workflow Definition Customized', entity: 'definition', category: 'lifecycle' },
  { id: 'workflows.definition.reset_to_code', label: 'Workflow Definition Reset to Code', entity: 'definition', category: 'lifecycle' },
  { id: 'workflows.definition.published', label: 'Workflow Definition Published', entity: 'definition', category: 'lifecycle' },

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

  // User Task Events
  { id: 'workflows.task.assigned', label: 'Task Assigned', entity: 'task', category: 'lifecycle' },
  { id: 'workflows.task.reminder_due', label: 'Task Reminder Due', entity: 'task', category: 'lifecycle' },
  { id: 'workflows.task.deadline_breached', label: 'Task Deadline Breached', entity: 'task', category: 'lifecycle' },
  /**
   * A task addressed to a PORTAL principal, bridged to that principal's browser
   * so it appears without a reload.
   *
   * A separate event rather than `portalBroadcast` on `workflows.task.assigned`,
   * and the difference is a leak. The portal SSE bridge scopes a payload by
   * tenant + organization and narrows to one user ONLY when the payload carries
   * `recipientUserId`; `workflows.task.assigned` carries none, plus the task
   * name and its entity bindings — broadcasting it would hand every portal user
   * in the organization the name of every other customer's task. This one is
   * addressed to exactly one principal and carries an ID and nothing else, so
   * the receiver has to ask the (authorized) API what it is.
   */
  { id: 'workflows.task.portal_assigned', label: 'Portal Task Assigned', entity: 'task', category: 'lifecycle', portalBroadcast: true, excludeFromTriggers: true },

  // Activity Events
  { id: 'workflows.activity.started', label: 'Activity Started', category: 'lifecycle' },
  { id: 'workflows.activity.completed', label: 'Activity Completed', category: 'lifecycle' },
  { id: 'workflows.activity.failed', label: 'Activity Failed', category: 'lifecycle' },

  // Event Triggers
  { id: 'workflows.trigger.created', label: 'Trigger Created', entity: 'trigger', category: 'crud' },
  { id: 'workflows.trigger.updated', label: 'Trigger Updated', entity: 'trigger', category: 'crud' },
  { id: 'workflows.trigger.deleted', label: 'Trigger Deleted', entity: 'trigger', category: 'crud' },

  // Parallel Fork / Join (branch lifecycle)
  { id: 'workflows.branch.opened', label: 'Parallel Branch Opened', entity: 'branch', category: 'lifecycle' },
  { id: 'workflows.branch.completed', label: 'Parallel Branch Completed', entity: 'branch', category: 'lifecycle' },
  { id: 'workflows.branch.cancelled', label: 'Parallel Branch Cancelled', entity: 'branch', category: 'lifecycle' },
  { id: 'workflows.branch.failed', label: 'Parallel Branch Failed', entity: 'branch', category: 'lifecycle' },
  { id: 'workflows.join.completed', label: 'Parallel Join Completed', entity: 'branch', category: 'lifecycle' },
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
