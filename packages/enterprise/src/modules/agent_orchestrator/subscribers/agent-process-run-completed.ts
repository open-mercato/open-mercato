import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/agentProcessProjection'

/**
 * Process projection (spec 2026-06-25): a finished run refreshes the AGENTS
 * stack, run count, and last-activity. The payload carries no processId, so the
 * recompute resolves it from the run row (same module — no cross-module read).
 */
export const metadata = {
  event: 'agent_orchestrator.run.completed',
  persistent: true,
  id: 'agent_orchestrator:agent-process-run-completed',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  const runId = typeof record.id === 'string' ? record.id : null
  await recomputeFromEvent(em, record, { resolveProcessIdFromRunId: runId })
}
