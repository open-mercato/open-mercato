import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Agent Orchestrator — widget injection table (area-04 cockpit UI).
 *
 * The additive My Tasks row-action link plus the task-detail proposal draft
 * card. The process-detail
 * timeline injection (`AgentTimeline` into the workflows instance detail) is
 * deferred: the workflows `backend/instances/[id]/page.tsx` exposes no
 * injection spot yet, and adding one requires modifying a workflows-owned file
 * (coordinate with the workflows owner per the area-04 spec). The
 * `AgentTimeline` component ships ready to mount once that spot exists.
 */
export const injectionTable: ModuleInjectionTable = {
  'data-table:workflows.tasks.list:row-actions': [
    {
      widgetId: 'agent_orchestrator.injection.task-proposal-link',
      priority: 30,
    },
  ],
  // Spec §7.6 — the pending proposal as a draft card on its disposition task,
  // with a one-click link to the run trace. The task detail page can only walk
  // a `formSchema` generically, so without this the operator is asked to
  // approve a key/value dump of the mutation.
  'workflows.task.detail:context': [
    {
      widgetId: 'agent_orchestrator.injection.task-proposal-draft',
      priority: 30,
    },
  ],
}

export default injectionTable
