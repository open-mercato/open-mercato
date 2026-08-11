import type { EntityManager } from '@mikro-orm/postgresql'
import {
  resolveWorkflowProcessRun,
  type WorkflowInstanceLifecyclePayload,
} from '../lib/tasks/resolveWorkflowProcessRun'

/** Workflow-target process runs fail when their instance fails. */
export const metadata = {
  event: 'workflows.instance.failed',
  persistent: true,
  id: 'agent_orchestrator:task-run-workflow-failed',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  await resolveWorkflowProcessRun(em, (payload ?? {}) as WorkflowInstanceLifecyclePayload, 'failed')
}
