import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProposal } from '../../data/entities'
import type { AgentRuntimeService } from './agentRuntime'
import type {
  DispositionService,
  DispositionOnResult,
} from '../disposition/dispositionService'

/**
 * DI bridge consumed by the workflows `INVOKE_AGENT` activity executor. It keeps
 * all `AgentProposal` access inside `agent_orchestrator` so the workflows module
 * never imports this module's entities (workflows treats it as an optional peer
 * resolved via `tryResolve('agentWorkflowBridge')`).
 */
export type InvokeAgentForWorkflowArgs = {
  agentId: string
  input: unknown
  onResult: DispositionOnResult
  ctx: {
    tenantId: string
    organizationId: string
    userId?: string
    processId: string
    stepId: string
  }
}

export type InvokeAgentForWorkflowOutcome =
  | { kind: 'informative'; data: unknown }
  | { kind: 'auto_approved'; proposalId: string; payload: unknown }
  | { kind: 'user_task'; proposalId: string }

export interface AgentWorkflowBridge {
  invokeAgentForWorkflow(
    args: InvokeAgentForWorkflowArgs,
  ): Promise<InvokeAgentForWorkflowOutcome>
}

export type AgentWorkflowBridgeDeps = {
  container: AwilixContainer
  agentRuntime: AgentRuntimeService
  dispositionService: DispositionService
}

export class AgentWorkflowBridgeService implements AgentWorkflowBridge {
  private readonly container: AwilixContainer
  private readonly agentRuntime: AgentRuntimeService
  private readonly dispositionService: DispositionService

  constructor(deps: AgentWorkflowBridgeDeps) {
    this.container = deps.container
    this.agentRuntime = deps.agentRuntime
    this.dispositionService = deps.dispositionService
  }

  async invokeAgentForWorkflow(
    args: InvokeAgentForWorkflowArgs,
  ): Promise<InvokeAgentForWorkflowOutcome> {
    const { agentId, input, onResult, ctx } = args

    const result = await this.agentRuntime.run(agentId, input, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId ?? '',
      processId: ctx.processId,
      stepId: ctx.stepId,
    })

    if (result.kind === 'informative') {
      return { kind: 'informative', data: result.data }
    }

    const em = (this.container.resolve('em') as EntityManager).fork()
    const proposal = await em.findOne(
      AgentProposal,
      {
        processId: ctx.processId,
        stepId: ctx.stepId,
        disposition: 'pending',
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
      { orderBy: { createdAt: 'DESC' } },
    )
    if (!proposal) {
      throw new Error('[internal] agent proposal not found after run')
    }

    const outcome = await this.dispositionService.dispose(proposal, onResult, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      processId: ctx.processId,
      stepId: ctx.stepId,
    })

    return outcome.kind === 'auto_approved'
      ? { kind: 'auto_approved', proposalId: outcome.proposalId, payload: proposal.payload }
      : { kind: 'user_task', proposalId: outcome.proposalId }
  }
}
