import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/agentProcessProjection'

/**
 * Process projection (spec 2026-06-25): every disposition verdict (rule or
 * human) recomputes the pending count, waiting-since, and derived status.
 */
export const metadata = {
  event: 'agent_orchestrator.proposal.disposed',
  persistent: true,
  id: 'agent_orchestrator:agent-process-proposal-disposed',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  await recomputeFromEvent(em, (payload ?? {}) as Record<string, unknown>)
}
