import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export const AGENT_GOVERNANCE_DISPATCH_QUEUE = 'agent-governance-dispatch'

export type AgentGovernanceDispatchJob = {
  tenantId: string
  organizationId: string
  playbookId?: string | null
  policyId?: string | null
  riskBandId?: string | null
  autonomyMode?: 'propose' | 'assist' | 'auto'
  actionClass?: 'read' | 'write' | 'irreversible'
  actionType?: string
  targetEntity?: string
  targetId?: string | null
  inputContext?: Record<string, unknown>
  riskScore?: number | null
  requireApproval?: boolean
  sourceRefs?: string[]
  _idempotencyKey?: string
}

export const metadata: WorkerMeta = {
  queue: AGENT_GOVERNANCE_DISPATCH_QUEUE,
  id: 'agent-governance:dispatch-run',
  concurrency: 5,
}

type HandlerContext = {
  resolve: <T = unknown>(name: string) => T
}

function resolveIdempotencyKey(job: AgentGovernanceDispatchJob): string {
  if (typeof job._idempotencyKey === 'string' && job._idempotencyKey.trim().length > 0) {
    return job._idempotencyKey
  }

  const bucket = new Date().toISOString().slice(0, 16)
  return `dispatch:${job.playbookId ?? 'none'}:${job.actionType ?? 'playbook.execute'}:${bucket}`
}

export default async function handle(
  job: QueuedJob<AgentGovernanceDispatchJob>,
  ctx: JobContext & HandlerContext,
): Promise<void> {
  const payload = job.payload

  if (!payload?.tenantId || !payload?.organizationId) {
    throw new Error('Dispatch job requires tenantId and organizationId.')
  }

  const commandBus = ctx.resolve<CommandBus>('commandBus')
  const commandContext: CommandRuntimeContext = {
    container: ctx as unknown as AppContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: payload.organizationId,
    organizationIds: [payload.organizationId],
    request: undefined,
  }

  const actionType = payload.actionType ?? 'playbook.execute'
  const targetEntity = payload.targetEntity ?? 'agent_governance_playbook'
  const targetId = payload.targetId ?? payload.playbookId ?? null
  const idempotencyKey = resolveIdempotencyKey(payload)

  await commandBus.execute('agent_governance.runs.start', {
    input: {
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      playbookId: payload.playbookId ?? null,
      policyId: payload.policyId ?? null,
      riskBandId: payload.riskBandId ?? null,
      autonomyMode: payload.autonomyMode ?? 'propose',
      actionClass: payload.actionClass,
      actionType,
      targetEntity,
      targetId,
      inputContext: {
        ...(payload.inputContext ?? {}),
        dispatchQueue: AGENT_GOVERNANCE_DISPATCH_QUEUE,
        dispatchJobId: ctx.jobId,
      },
      sourceRefs: payload.sourceRefs ?? [],
      riskScore: payload.riskScore ?? null,
      requireApproval: payload.requireApproval,
      idempotencyKey,
    },
    ctx: commandContext,
  })
}
