import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/agentProcessProjection'

/** Process projection Phase B (spec 2026-06-25): cancelled instance → `cancelled`. */
export const metadata = {
  event: 'workflows.instance.cancelled',
  persistent: true,
  id: 'agent_orchestrator:agent-process-workflow-cancelled',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  await recomputeFromEvent(
    em,
    { ...record, processId: record.id },
    { createIfMissing: false, terminal: 'cancelled' },
  )
}
