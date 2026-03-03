import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernanceRun } from '../data/entities'
import { emitAgentGovernanceEvent } from '../events'

export const AGENT_GOVERNANCE_REPAIR_QUEUE = 'agent-governance-repair'

export type AgentGovernanceRepairJob = {
  runId?: string | null
  targetEntity?: string | null
  targetId?: string | null
  tenantId: string
  organizationId: string
}

export const metadata: WorkerMeta = {
  queue: AGENT_GOVERNANCE_REPAIR_QUEUE,
  id: 'agent-governance:telemetry-repair',
  concurrency: 2,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(
  job: QueuedJob<AgentGovernanceRepairJob>,
  ctx: JobContext & HandlerContext,
): Promise<void> {
  const payload = job.payload

  if (!payload?.tenantId || !payload?.organizationId) {
    throw new Error('Repair job requires tenantId and organizationId.')
  }

  const em = ctx.resolve<EntityManager>('em')

  const run = payload.runId
    ? await findOneWithDecryption(
        em,
        AgentGovernanceRun,
        {
          id: payload.runId,
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
        },
        undefined,
        {
          tenantId: payload.tenantId,
          organizationId: payload.organizationId,
        },
      )
    : null

  if (run && (run.status === 'running' || run.status === 'checkpoint')) {
    const commandBus = ctx.resolve<CommandBus>('commandBus')
    const commandContext: CommandRuntimeContext = {
      container: ctx as unknown as AppContainer,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: payload.organizationId,
      organizationIds: [payload.organizationId],
      request: undefined,
    }

    await commandBus.execute('agent_governance.runs.pause', {
      input: {
        id: run.id,
        reason: 'Telemetry repair intervention required',
      },
      ctx: commandContext,
    })
  }

  await emitAgentGovernanceEvent('agent_governance.anomaly.detected', {
    type: 'telemetry_repair_required',
    severity: run ? (run.status === 'running' || run.status === 'checkpoint' ? 'high' : 'medium') : 'medium',
    route: run ? 'operators' : 'governance_admins',
    runId: run?.id ?? payload.runId ?? null,
    targetEntity: payload.targetEntity ?? null,
    targetId: payload.targetId ?? null,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  })
}
