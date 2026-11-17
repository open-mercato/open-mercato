import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/processProjection'

/**
 * Terminal resolution of the execution projection. A completed instance flips the
 * row to `auto_completed` (all dispositions auto) or `completed` (≥1 human
 * verdict) and stamps the OPTIONAL outcome the instance declared under its
 * context `outcome` key. Update-only — never creates rows.
 *
 * The workflow instance is the lifecycle owner; this subscriber READS its
 * terminal state rather than deciding one. The predecessor model ran a second
 * subscriber alongside this one to flip an independent ledger status, and the two
 * could disagree — there is now exactly one status.
 */
export const metadata = {
  event: 'workflows.instance.completed',
  persistent: true,
  id: 'agent_orchestrator:process-workflow-completed',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  await recomputeFromEvent(
    em,
    { ...record, workflowInstanceId: record.id },
    { createIfMissing: false, terminal: 'completed', resolver: ctx },
  )
}
