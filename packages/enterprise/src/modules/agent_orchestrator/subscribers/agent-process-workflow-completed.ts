import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/agentProcessProjection'

/**
 * Process projection Phase B (spec 2026-06-25): terminal resolution. A completed
 * instance flips the row to `auto_completed` (all dispositions auto) or
 * `completed` (≥1 human verdict). Update-only — never creates rows.
 */
export const metadata = {
  event: 'workflows.instance.completed',
  persistent: true,
  id: 'agent_orchestrator:agent-process-workflow-completed',
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
    { createIfMissing: false, terminal: 'completed' },
  )
}
