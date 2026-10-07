import type { EntityManager } from '@mikro-orm/postgresql'
import { recordMilestoneReached } from '../lib/processes/processProjection'

/**
 * A business milestone the workflow announced.
 *
 * The workflow emits `workflows.instance.milestone_reached` when a step carrying
 * a `milestone` annotation completes — after a parallel join, after a retry, or
 * after ten steps, all the same. This subscriber records that it happened; it
 * never infers a milestone from a step id, because a milestone is not a step.
 *
 * Update-only and idempotent per key: an execution with no projection row (a
 * plain Studio workflow with no business process above it) has no business
 * narrative to append to, and a redelivered event must not make the narrative
 * stutter.
 */
export const metadata = {
  event: 'workflows.instance.milestone_reached',
  persistent: true,
  id: 'agent_orchestrator:process-workflow-milestone',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const record = (payload ?? {}) as Record<string, unknown>
  const tenantId = typeof record.tenantId === 'string' ? record.tenantId : null
  const organizationId = typeof record.organizationId === 'string' ? record.organizationId : null
  const workflowInstanceId = typeof record.instanceId === 'string' ? record.instanceId : null
  const key = typeof record.milestoneKey === 'string' ? record.milestoneKey : null
  if (!tenantId || !organizationId || !workflowInstanceId || !key) return

  const em = (ctx.resolve('em') as EntityManager).fork()
  await recordMilestoneReached(
    em,
    { tenantId, organizationId },
    workflowInstanceId,
    {
      key,
      at: typeof record.occurredAt === 'string' ? record.occurredAt : undefined,
      data: record.data && typeof record.data === 'object' && !Array.isArray(record.data)
        ? (record.data as Record<string, unknown>)
        : null,
    },
  )
}
