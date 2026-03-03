import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { DecisionProjectorService } from '../services/decision-projector-service'
import { emitAgentGovernanceEvent } from '../events'

export const AGENT_GOVERNANCE_PROJECTION_QUEUE = 'agent-governance-projection'

export type AgentGovernanceProjectionJob = {
  eventId: string
  tenantId?: string | null
  organizationId?: string | null
}

export const metadata: WorkerMeta = {
  queue: AGENT_GOVERNANCE_PROJECTION_QUEUE,
  id: 'agent-governance:project-decision',
  concurrency: 3,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<AgentGovernanceProjectionJob>,
  ctx: JobContext & HandlerContext,
): Promise<void> {
  const payload = job.payload

  if (!payload?.eventId) {
    throw new Error('Projection job requires eventId.')
  }

  const projector = ctx.resolve<DecisionProjectorService>('agentGovernanceDecisionProjectorService')

  const projection = await projector.projectDecisionEvent({
    eventId: payload.eventId,
    tenantId: payload.tenantId ?? null,
    organizationId: payload.organizationId ?? null,
  })

  if (!projection.projected) {
    return
  }

  await emitAgentGovernanceEvent('agent_governance.precedent.indexed', {
    eventId: payload.eventId,
    tenantId: payload.tenantId ?? null,
    organizationId: payload.organizationId ?? null,
    checksum: projection.checksum,
    entityLinks: projection.entityLinks,
    whyLinks: projection.whyLinks,
  })
}
