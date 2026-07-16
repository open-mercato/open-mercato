import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AgentProposal } from '../../data/entities'
import type {
  DisposeProposalCommandInput,
  DisposeProposalCommandResult,
} from '../../commands/dispose'

/**
 * Disposition config carried verbatim from the area-02 Invoke Agent node's
 * `onResult`. `alwaysAsk` always routes to a human; otherwise a single
 * confidence threshold gates auto-approval.
 */
export type DispositionOnResult =
  | { autoApproveThreshold: number }
  | { alwaysAsk: true }

export type DispositionCtx = {
  tenantId: string
  organizationId: string
  userId?: string
  processId: string
  stepId: string
}

export type DispositionOutcome =
  | { kind: 'auto_approved'; proposalId: string }
  | { kind: 'user_task'; userTaskId: string; proposalId: string }

export interface DispositionService {
  dispose(
    proposal: AgentProposal,
    onResult: DispositionOnResult,
    ctx: DispositionCtx,
  ): Promise<DispositionOutcome>
}

function shouldAutoApprove(proposal: AgentProposal, onResult: DispositionOnResult): boolean {
  // alwaysAsk → always human.
  if ('alwaysAsk' in onResult) return false
  // Fail-closed: a missing / null confidence is treated as below threshold.
  if (typeof proposal.confidence !== 'number') return false
  return proposal.confidence >= onResult.autoApproveThreshold
}

/**
 * MVP DispositionService — a thin DI service called INLINE by the area-02
 * `INVOKE_AGENT` executor right after `agentRuntime.run`. It does NOT subscribe
 * to `proposal.created` (an event-driven seam would lose the activity's
 * transaction scope and race `WAIT_FOR_SIGNAL`).
 *
 * - Auto-approve (confidence ≥ threshold, not `alwaysAsk`): dispose through the
 *   audited `agent_orchestrator.proposals.dispose` Command with the internal
 *   `auto_approved` verdict (`dispositionBy = 'rule:threshold'`, `skipResume`),
 *   then return `{ kind:'auto_approved' }`. The Command emits
 *   `proposal.disposed`. NO `proposal.ready` is emitted and the executor
 *   proceeds without parking (avoids a park-before-signal race).
 * - Ask-a-human (below threshold / `alwaysAsk` / null confidence): raise a
 *   workflows `USER_TASK` surfacing the proposal payload; the instance stays
 *   parked at `WAIT_FOR_SIGNAL`. Return `{ kind:'user_task' }`. The operator's
 *   dispose endpoint later emits `proposal.ready` to resume.
 *
 * `workflows` is an optional peer: the USER_TASK creation is guarded so the
 * service degrades gracefully when the module is absent (it still returns a
 * `user_task` outcome with a synthetic id).
 */
export class DispositionServiceImpl implements DispositionService {
  constructor(private readonly container: AwilixContainer) {}

  async dispose(
    proposal: AgentProposal,
    onResult: DispositionOnResult,
    ctx: DispositionCtx,
  ): Promise<DispositionOutcome> {
    if (shouldAutoApprove(proposal, onResult)) {
      return this.autoApprove(proposal)
    }
    return this.raiseUserTask(proposal, ctx)
  }

  private async autoApprove(proposal: AgentProposal): Promise<DispositionOutcome> {
    const commandBus = this.container.resolve('commandBus') as CommandBus
    const commandCtx: CommandRuntimeContext = {
      container: this.container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: proposal.organizationId,
      organizationIds: [proposal.organizationId],
      systemActor: true,
    }
    await commandBus.execute<DisposeProposalCommandInput, DisposeProposalCommandResult>(
      'agent_orchestrator.proposals.dispose',
      {
        input: {
          proposalId: proposal.id,
          tenantId: proposal.tenantId,
          organizationId: proposal.organizationId,
          disposition: 'auto_approved',
          dispositionBy: 'rule:threshold',
          skipResume: true,
        },
        ctx: commandCtx,
      },
    )
    return { kind: 'auto_approved', proposalId: proposal.id }
  }

  private async raiseUserTask(
    proposal: AgentProposal,
    ctx: DispositionCtx,
  ): Promise<DispositionOutcome> {
    const userTaskId = await this.createUserTask(proposal, ctx)
    return { kind: 'user_task', userTaskId, proposalId: proposal.id }
  }

  private async createUserTask(
    proposal: AgentProposal,
    ctx: DispositionCtx,
  ): Promise<string> {
    try {
      const entities = (await import(
        '@open-mercato/core/modules/workflows/data/entities'
      )) as typeof import('@open-mercato/core/modules/workflows/data/entities')
      const em = (this.container.resolve('em') as EntityManager).fork()

      const stepInstance = await em.findOne(entities.StepInstance, {
        workflowInstanceId: ctx.processId,
        stepId: ctx.stepId,
        status: 'ACTIVE',
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })

      const task = em.create(entities.UserTask, {
        workflowInstanceId: ctx.processId,
        stepInstanceId: stepInstance?.id ?? ctx.processId,
        taskName: `Dispose agent proposal (${proposal.agentId})`,
        description: 'Review and approve, edit, or reject the agent proposal.',
        status: 'PENDING',
        formSchema: { proposalId: proposal.id, payload: proposal.payload, confidence: proposal.confidence ?? null },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      em.persist(task)
      await em.flush()
      return task.id
    } catch (error) {
      console.warn('[agent_orchestrator] USER_TASK not created (workflows peer absent?)', {
        proposalId: proposal.id,
        processId: ctx.processId,
        error: error instanceof Error ? error.message : String(error),
      })
      return `pending:${proposal.id}`
    }
  }
}
