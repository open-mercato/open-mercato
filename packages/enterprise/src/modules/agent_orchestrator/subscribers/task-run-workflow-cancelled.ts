import type { EntityManager } from '@mikro-orm/postgresql'
import {
  resolveWorkflowTaskRun,
  type WorkflowInstanceLifecyclePayload,
} from '../lib/tasks/resolveWorkflowTaskRun'

/**
 * A cancelled instance would otherwise leave the ledger 'running' forever —
 * resolve it as failed with an explicit cancellation reason.
 */
export const metadata = {
  event: 'workflows.instance.cancelled',
  persistent: true,
  id: 'agent_orchestrator:task-run-workflow-cancelled',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  await resolveWorkflowTaskRun(em, (payload ?? {}) as WorkflowInstanceLifecyclePayload, 'failed', 'Workflow instance cancelled')
}
