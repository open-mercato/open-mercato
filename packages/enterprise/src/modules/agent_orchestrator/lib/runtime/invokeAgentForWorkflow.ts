import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProposal } from '../../data/entities'
import type { AgentRuntimeService } from './agentRuntime'
import type { AgentRunAs } from './persistence'
import { resolveAgentPrincipal } from '../identity/agentPrincipalService'
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

    // On-behalf-of attribution (Wave 4 P2): if this agent has a provisioned
    // principal, run as the agent (actor) on behalf of the invoking human, so
    // every ActionLog the run writes is attributed agent→human, sourced 'agent',
    // through the SAME audited Command path. When no principal is provisioned yet
    // the run keeps its prior `userId`-derived attribution (additive, fail-open).
    const runAs = await this.resolveRunAs(agentId, ctx)

    const result = await this.agentRuntime.run(agentId, input, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId ?? '',
      processId: ctx.processId,
      stepId: ctx.stepId,
      ...(runAs ? { runAs } : {}),
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

  /**
   * Resolves the on-behalf-of attribution for an `INVOKE_AGENT` run. Returns the
   * agent principal's `auth.User` id (actor) + the invoking human (`onBehalfOfUserId`)
   * when the agent is provisioned and enabled; null otherwise (fail-open — the run
   * keeps its `userId`-derived attribution until a principal exists). Org-scoped.
   */
  private async resolveRunAs(
    agentId: string,
    ctx: InvokeAgentForWorkflowArgs['ctx'],
  ): Promise<AgentRunAs | null> {
    const principal = await resolveAgentPrincipal(
      this.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      agentId,
    )
    if (!principal || !principal.enabled) return null
    return {
      agentUserId: principal.userId,
      onBehalfOfUserId: ctx.userId ?? null,
    }
  }
}
