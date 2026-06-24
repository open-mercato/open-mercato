import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Agent Orchestrator — widget injection table (area-04 cockpit UI).
 *
 * Only the additive My Tasks row-action link is wired here. The process-detail
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
}

export default injectionTable
