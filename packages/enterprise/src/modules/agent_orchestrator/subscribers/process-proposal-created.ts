import type { EntityManager } from '@mikro-orm/postgresql'
import { recomputeFromEvent } from '../lib/processes/processProjection'
import type { ProcessSubject } from '../data/validators'

/**
 * Process projection (spec 2026-06-25): a new proposal creates/refreshes the
 * process row — this is the event that carries the INVOKE_AGENT `subject`
 * descriptor, so it is also where the projection first learns what business
 * record the process is about.
 */
export const metadata = {
  event: 'agent_orchestrator.proposal.created',
  persistent: true,
  id: 'agent_orchestrator:process-proposal-created',
}

export default async function handle(
  payload: unknown,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<void> {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const record = (payload ?? {}) as Record<string, unknown>
  const subject =
    record.subject && typeof record.subject === 'object'
      ? (record.subject as ProcessSubject)
      : null
  await recomputeFromEvent(em, record, { subject })
}
