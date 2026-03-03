import { emitAgentGovernanceEvent } from '../events'

export const metadata = {
  event: 'agent_governance.run.failed',
  persistent: true,
  id: 'agent-governance-detect-run-failure-anomaly',
}

type RunFailedPayload = {
  id?: unknown
  tenantId?: unknown
  organizationId?: unknown
  reason?: unknown
}

export default async function handle(payload: RunFailedPayload): Promise<void> {
  const runId = typeof payload?.id === 'string' ? payload.id : null
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId : null

  if (!tenantId || !organizationId) {
    return
  }

  await emitAgentGovernanceEvent('agent_governance.anomaly.detected', {
    type: 'run_failed',
    severity: 'high',
    route: 'operators',
    runId,
    reason: typeof payload?.reason === 'string' ? payload.reason : null,
    tenantId,
    organizationId,
  })
}
