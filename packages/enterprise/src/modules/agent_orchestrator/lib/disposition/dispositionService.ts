import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentProposal } from '../../data/entities'
import type {
  DisposeProposalCommandInput,
  DisposeProposalCommandResult,
} from '../../commands/dispose'

const logger = createLogger('agent_orchestrator').child({ component: 'disposition-service' })

/**
 * Disposition config carried verbatim from the area-02 Invoke Agent node's
 * `onResult`. `alwaysAsk` always routes to a human; otherwise a single
 * confidence threshold gates auto-approval.
 */
export type DispositionOnResult =
  | { autoApproveThreshold: number }
  | { alwaysAsk: true }

/**
 * The Invoke Agent node's Review section (spec §7.5), already resolved by the
 * workflows engine against the run context. Re-exported from the workflows
 * module so the two sides cannot drift; `workflows` is an OPTIONAL peer, so the
 * import is type-only and erased at run time.
 */
export type AgentDispositionReview =
  import('@open-mercato/core/modules/workflows/lib/agent-disposition-task').AgentDispositionReview

export type DispositionCtx = {
  tenantId: string
  organizationId: string
  userId?: string
  processId: string
  stepId: string
  /**
   * Who reviews this proposal and by when, authored on the agent node. Absent
   * means the unassigned task this service raised before §7.5 — which under the
   * workflows §6.4 visibility model is a task nobody can act on.
   */
  review?: AgentDispositionReview
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
 *   workflows `USER_TASK` surfacing the proposal payload, routed to whoever the
 *   agent node's Review section names (spec §7.5); the instance stays parked at
 *   `WAIT_FOR_SIGNAL`. Return `{ kind:'user_task' }`. The operator's dispose
 *   endpoint later emits `proposal.ready` to resume. Building that row belongs
 *   to the workflows module — it owns the entity, the audit log and the
 *   assignment event — so this service passes the Review descriptor to
 *   `createAgentDispositionTask` rather than assembling the row itself.
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
      const dispositionTask = (await import(
        '@open-mercato/core/modules/workflows/lib/agent-disposition-task'
      )) as typeof import('@open-mercato/core/modules/workflows/lib/agent-disposition-task')
      const em = (this.container.resolve('em') as EntityManager).fork()

      const created = await dispositionTask.createAgentDispositionTask(em, this.container, {
        workflowInstanceId: ctx.processId,
        stepId: ctx.stepId,
        proposalId: proposal.id,
        agentId: proposal.agentId,
        proposalPayload: proposal.payload,
        confidence: proposal.confidence ?? null,
        taskName: `Dispose agent proposal (${proposal.agentId})`,
        description: 'Review and approve, edit, or reject the agent proposal.',
        review: ctx.review ?? null,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
      })
      await this.recordUserTaskId(proposal, created.userTaskId)
      return created.userTaskId
    } catch (error) {
      logger.warn('USER_TASK not created (workflows peer absent?)', {
        proposalId: proposal.id,
        processId: ctx.processId,
        error: error instanceof Error ? error.message : String(error),
      })
      return `pending:${proposal.id}`
    }
  }

  /**
   * Link the proposal to the review task raised for it, so `commands/dispose.ts`
   * can close that task once a verdict lands (A7).
   *
   * A targeted `nativeUpdate` rather than a managed write: it must NOT touch
   * `updated_at`, which is the proposal's optimistic-lock token — bumping it
   * here would invalidate a caseload modal that had already loaded the row and
   * turn the link into a spurious 409 for the operator.
   */
  private async recordUserTaskId(proposal: AgentProposal, userTaskId: string): Promise<void> {
    try {
      const em = (this.container.resolve('em') as EntityManager).fork()
      await em.nativeUpdate(
        AgentProposal,
        { id: proposal.id, tenantId: proposal.tenantId, organizationId: proposal.organizationId },
        { userTaskId },
      )
      proposal.userTaskId = userTaskId
    } catch (error) {
      // The task exists and the proposal is pending; losing the link costs the
      // automatic close, never the review itself.
      logger.warn('proposal not linked to its review task', {
        proposalId: proposal.id,
        userTaskId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
