import { createQueue } from '@open-mercato/queue'
import { AGENT_GOVERNANCE_PROJECTION_QUEUE, type AgentGovernanceProjectionJob } from '../workers/project-decision.worker'

export const metadata = {
  event: 'agent_governance.decision.recorded',
  persistent: true,
  id: 'agent-governance-project-decision-memory',
}

type DecisionRecordedPayload = {
  eventId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: DecisionRecordedPayload, ctx: SubscriberContext): Promise<void> {
  const eventId = typeof payload?.eventId === 'string' ? payload.eventId : null
  if (!eventId) {
    return
  }

  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId : null

  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
  const projectionQueue = createQueue<AgentGovernanceProjectionJob>(AGENT_GOVERNANCE_PROJECTION_QUEUE, strategy)

  await projectionQueue.enqueue({
    eventId,
    tenantId: tenantId ?? null,
    organizationId: organizationId ?? null,
  })
}
