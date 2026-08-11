import type { EntityManager } from '@mikro-orm/postgresql'
import {
  resolveWorkflowProcessRun,
  type WorkflowInstanceLifecyclePayload,
} from '../lib/tasks/resolveWorkflowProcessRun'

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
  await resolveWorkflowProcessRun(em, (payload ?? {}) as WorkflowInstanceLifecyclePayload, 'failed', 'Workflow instance cancelled')
}
