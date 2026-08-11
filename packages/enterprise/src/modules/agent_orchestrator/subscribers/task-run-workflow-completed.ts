import type { EntityManager } from '@mikro-orm/postgresql'
import {
  resolveWorkflowProcessRun,
  type WorkflowInstanceLifecyclePayload,
} from '../lib/tasks/resolveWorkflowProcessRun'

/** Workflow-target process runs complete when their instance completes. */
export const metadata = {
  event: 'workflows.instance.completed',
  persistent: true,
  id: 'agent_orchestrator:task-run-workflow-completed',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  await resolveWorkflowProcessRun(em, (payload ?? {}) as WorkflowInstanceLifecyclePayload, 'completed')
}
