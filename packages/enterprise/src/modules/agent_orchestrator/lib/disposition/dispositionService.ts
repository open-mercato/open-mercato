import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentProposal } from '../../data/entities'
import type { AutoDispositionBlock, ProposalOption } from '../../data/validators'
import { normalizeProposalEnvelope, rankProposalOptions } from '../../data/proposalEnvelope'
import type {
  DisposeProposalCommandInput,
  DisposeProposalCommandResult,
} from '../../commands/dispose'

const logger = createLogger('agent_orchestrator').child({ component: 'disposition-service' })

/**
 * Disposition config carried verbatim from the area-02 Invoke Agent node's
 * `onResult`. `alwaysAsk` always routes to a human; otherwise a confidence
 * threshold plus an optional separation MARGIN gates auto-approval.
 *
 * `autoApproveMargin` is optional here (not just defaulted in the zod schema)
 * because a queue job enqueued before the field existed carries no value —
 * absent means `0`, which is exactly today's rule.
 */
export type DispositionOnResult =
  | { autoApproveThreshold: number; autoApproveMargin?: number }
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
  | { kind: 'auto_approved'; proposalId: string; selectedOptionId: string }
  | { kind: 'user_task'; userTaskId: string; proposalId: string }
  /** The agent proposed nothing; there is no decision to raise and none to auto-approve. */
  | { kind: 'none_proposed'; proposalId: string }

export interface DispositionService {
  dispose(
    proposal: AgentProposal,
    onResult: DispositionOnResult,
    ctx: DispositionCtx,
  ): Promise<DispositionOutcome>
}

export type AutoApprovalDecision =
  | { kind: 'approve'; option: ProposalOption }
  | { kind: 'review'; block: AutoDispositionBlock | null }

/**
 * Threshold AND margin.
 *
 * The `alwaysAsk` short-circuit is FIRST and is load-bearing: dropping it makes every
 * `alwaysAsk: true` node start auto-approving, which is the worst regression this
 * module can produce. The `typeof confidence !== 'number'` guard is equally
 * load-bearing — a missing confidence fails closed to a human, never to approval.
 *
 * The margin exists because a 0.81/0.80 split under an 0.8 threshold is the agent
 * saying it cannot tell its top two options apart; reading that as certainty is how
 * an auto-approved wrong answer happens. It defaults to 0, which preserves today's
 * rule exactly — a `.default()` that changed behaviour without anyone asking would be
 * the opposite of opt-in.
 */
export function evaluateAutoApproval(
  options: readonly ProposalOption[],
  onResult: DispositionOnResult,
): AutoApprovalDecision {
  if ('alwaysAsk' in onResult) return { kind: 'review', block: null }
  if (options.length === 0) return { kind: 'review', block: null }
  const ranked = rankProposalOptions(options)
  const [top, runnerUp] = ranked
  if (typeof top.confidence !== 'number') return { kind: 'review', block: null }
  if (top.confidence < onResult.autoApproveThreshold) return { kind: 'review', block: null }
  const margin = onResult.autoApproveMargin ?? 0
  if (runnerUp && top.confidence - (runnerUp.confidence ?? 0) < margin) {
    return { kind: 'review', block: 'near_tie' }
  }
  return { kind: 'approve', option: top }
}

/** The option auto-approval would run, or null when a human must decide. */
export function autoApprovable(
  options: readonly ProposalOption[],
  onResult: DispositionOnResult,
): ProposalOption | null {
  const decision = evaluateAutoApproval(options, onResult)
  return decision.kind === 'approve' ? decision.option : null
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
    const { options } = normalizeProposalEnvelope(proposal.payload, proposal.agentId)
    // Nothing proposed: terminal at creation, so there is neither a decision to raise
    // nor a plan to approve. Routed onto the researcher outcome handle downstream.
    if (options.length === 0) {
      return { kind: 'none_proposed', proposalId: proposal.id }
    }
    const decision = evaluateAutoApproval(options, onResult)
    if (decision.kind === 'approve') {
      return this.autoApprove(proposal, decision.option)
    }
    return this.raiseUserTask(proposal, ctx, decision.block)
  }

  private async autoApprove(
    proposal: AgentProposal,
    option: ProposalOption,
  ): Promise<DispositionOutcome> {
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
          selectedOptionId: option.id,
          skipResume: true,
        },
        ctx: commandCtx,
      },
    )
    return { kind: 'auto_approved', proposalId: proposal.id, selectedOptionId: option.id }
  }

  private async raiseUserTask(
    proposal: AgentProposal,
    ctx: DispositionCtx,
    block: AutoDispositionBlock | null,
  ): Promise<DispositionOutcome> {
    if (block) await this.recordAutoDispositionBlock(proposal, block)
    const userTaskId = await this.createUserTask(proposal, ctx)
    return { kind: 'user_task', userTaskId, proposalId: proposal.id }
  }

  /**
   * A blocked auto-approval is not a failure — it is a proposal that cleared its
   * threshold and was held anyway, and silence would read as the threshold simply not
   * being met. Written with a targeted `nativeUpdate` for the same reason
   * `recordUserTaskId` is: `updated_at` is the proposal's optimistic-lock token and
   * bumping it here would turn the annotation into a spurious 409 for the operator.
   */
  private async recordAutoDispositionBlock(
    proposal: AgentProposal,
    block: AutoDispositionBlock,
  ): Promise<void> {
    try {
      const em = (this.container.resolve('em') as EntityManager).fork()
      await em.nativeUpdate(
        AgentProposal,
        { id: proposal.id, tenantId: proposal.tenantId, organizationId: proposal.organizationId },
        { autoDispositionBlock: block },
      )
      proposal.autoDispositionBlock = block
    } catch (error) {
      logger.warn('auto-disposition block not recorded', {
        proposalId: proposal.id,
        block,
        error: error instanceof Error ? error.message : String(error),
      })
    }
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
