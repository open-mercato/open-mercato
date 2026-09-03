import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/agentProcessProjection'

/**
 * Process projection (spec 2026-06-25): trace ingestion is where run cost/token
 * figures land on the run row, so it re-rolls the process COST aggregate.
 */
export const metadata = {
  event: 'agent_orchestrator.run.ingested',
  persistent: true,
  id: 'agent_orchestrator:agent-process-run-ingested',
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
