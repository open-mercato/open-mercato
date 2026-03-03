import { createQueue } from '@open-mercato/queue'
import { AGENT_GOVERNANCE_REPAIR_QUEUE, type AgentGovernanceRepairJob } from '../workers/telemetry-repair.worker'

export const metadata = {
  event: 'agent_governance.telemetry.repair_flagged',
  persistent: true,
  id: 'agent-governance-queue-telemetry-repair',
}

type TelemetryRepairPayload = {
  runId?: unknown
  targetEntity?: unknown
  targetId?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export default async function handle(payload: TelemetryRepairPayload): Promise<void> {
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId : null

  if (!tenantId || !organizationId) {
    return
  }

  const strategy = process.env.QUEUE_STRATEGY === 'async' ? 'async' : 'local'
  const repairQueue = createQueue<AgentGovernanceRepairJob>(AGENT_GOVERNANCE_REPAIR_QUEUE, strategy)

  await repairQueue.enqueue({
    runId: typeof payload?.runId === 'string' ? payload.runId : null,
    targetEntity: typeof payload?.targetEntity === 'string' ? payload.targetEntity : null,
    targetId: typeof payload?.targetId === 'string' ? payload.targetId : null,
    tenantId,
    organizationId,
  })
}
