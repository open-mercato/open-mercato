import type { EntityManager } from '@mikro-orm/postgresql'
import {
  resolveWorkflowTaskRun,
  type WorkflowInstanceLifecyclePayload,
} from '../lib/tasks/resolveWorkflowTaskRun'

/** Workflow-target task runs complete when their instance completes (Agentic Tasks Phase 3). */
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
  await resolveWorkflowTaskRun(em, (payload ?? {}) as WorkflowInstanceLifecyclePayload, 'completed')
}
