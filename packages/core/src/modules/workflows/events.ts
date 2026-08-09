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

  /**
   * Workflow lifecycle. All six carry `clientBroadcast: true` so the run views
   * update live through the DOM Event Bridge (spec §8.3).
   *
   * Safe to broadcast: the payload `emitInstanceLifecycleEvent` publishes is
   * instance identity and state — id, tenant, organization, workflowId,
   * version, status, current stepId — and carries no authored content, no task
   * name and no run context. It is also already tenant + organization scoped by
   * the bridge, which refuses to deliver a payload with no `tenantId` at all.
   *
   * `paused` and `resumed` are declared but have never had an emit site (see
   * `InstanceLifecycleEventId` in `lib/workflow-executor.ts`); the flag is
   * declared on them anyway so that whoever wires the emit does not have to
   * revisit the contract.
   */
  { id: 'workflows.instance.started', label: 'Workflow Started', category: 'lifecycle', clientBroadcast: true },
  { id: 'workflows.instance.completed', label: 'Workflow Completed', category: 'lifecycle', clientBroadcast: true },
  { id: 'workflows.instance.failed', label: 'Workflow Failed', category: 'lifecycle', clientBroadcast: true },
  { id: 'workflows.instance.cancelled', label: 'Workflow Cancelled', category: 'lifecycle', clientBroadcast: true },
  { id: 'workflows.instance.paused', label: 'Workflow Paused', category: 'lifecycle', clientBroadcast: true },
  { id: 'workflows.instance.resumed', label: 'Workflow Resumed', category: 'lifecycle', clientBroadcast: true },

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
  { id: 'workflows.task.assigned', label: 'Task Assigned', entity: 'task', category: 'lifecycle' },

  /**
   * Live agent-action telemetry for an INVOKE_AGENT step (spec §Phase 2). Emitted
   * per AI-SDK step by the optional `agent_orchestrator` peer's native runner so
   * the run view can show what the agent is doing WHILE it runs, instead of only
   * refetching on `instance.*` lifecycle changes. `clientBroadcast` so it reaches
   * the browser via the DOM Event Bridge; `excludeFromTriggers` because it is UI
   * telemetry, not a business signal a workflow should react to.
   *
   * Ephemeral and safe to broadcast: the payload is instance/step identity plus
   * a coarse action descriptor (`kind`: step_finish | tool_call, an optional tool
   * `name`, step index, tool-call count) — NO token text, NO model output, NO
   * authored content — and is tenant + organization scoped like the lifecycle
   * events. Low-frequency (a handful per agent run), so it fits the bridge's
   * dedup/heartbeat envelope where a token stream never could.
   */
  { id: 'workflows.agent.action', label: 'Workflow Agent Action', category: 'lifecycle', clientBroadcast: true, excludeFromTriggers: true },

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
