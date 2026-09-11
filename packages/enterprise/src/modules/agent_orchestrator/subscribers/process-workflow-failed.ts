import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/processProjection'

/** Terminal resolution: a failed instance → `failed`, carrying the instance's own reason. */
export const metadata = {
  event: 'workflows.instance.failed',
  persistent: true,
  id: 'agent_orchestrator:process-workflow-failed',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  const failureReason = typeof record.errorMessage === 'string' ? record.errorMessage : null
  await recomputeFromEvent(
    em,
    { ...record, workflowInstanceId: record.id },
    { createIfMissing: false, terminal: 'failed', failureReason },
  )
}
