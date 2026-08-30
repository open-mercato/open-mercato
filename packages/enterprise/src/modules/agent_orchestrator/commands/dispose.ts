import { registerCommand } from '@open-mercato/shared/lib/commands'
import type {
  CommandBus,
  CommandHandler,
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  enforceCommandOptimisticLock,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { AgentProposal, type AgentProposalDisposition } from '../data/entities'
import { PROPOSAL_OPTION_ID_MAX, disposeProposalSchema } from '../data/validators'
import { deriveEnvelopeConfidence, listProposalOptionIds } from '../data/proposalEnvelope'
import { emitAgentOrchestratorEvent } from '../events'
import { resumeWorkflowForProposal } from '../lib/disposition/resume'
import { invalidateAgentProposalCache } from '../lib/crudCache'

const logger = createLogger('agent_orchestrator').child({ command: 'dispose' })

const RESOURCE_KIND = 'agent_orchestrator.proposal'
const RESOURCE_KIND_GUARD = 'agent_orchestrator:proposal'

/**
 * Internal command input. The public dispose endpoint only sends the human
 * verdicts (`approved`/`edited`/`rejected`), validated against
 * `disposeProposalSchema`. The DispositionService passes the internal
 * `auto_approved` verdict (`dispositionBy = 'rule:threshold'`) so the audited
 * Command — not a raw `em.flush` — owns the auto-approve write too.
 */
const disposeCommandInputSchema = z.object({
  proposalId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  disposition: z.enum(['auto_approved', 'approved', 'edited', 'rejected']),
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().min(1).optional(),
  /**
   * Which of the proposal's options this verdict selects. Required for the option-
   * running verdicts (`approved`/`edited`/`auto_approved`), absent for `rejected`.
   */
  selectedOptionId: z.string().min(1).max(PROPOSAL_OPTION_ID_MAX).optional(),
  /** rule attribution for the internal auto-approve verdict (e.g. 'rule:threshold'). */
  dispositionBy: z.string().min(1).optional(),
  /**
   * Skip the human-path resume seam. The auto-approve path sets this — the
   * area-02 executor proceeds inline and never parked, so there is nothing to
   * signal (and emitting `proposal.ready` would race a never-parked instance).
   */
  skipResume: z.boolean().optional(),
})
export type DisposeProposalCommandInput = z.infer<typeof disposeCommandInputSchema>

export type DisposeProposalCommandResult = {
  proposalId: string
  disposition: AgentProposalDisposition
  dispositionBy: string | null
  /** Which envelope option the verdict selected; null on a reject or a legacy row. */
  selectedOptionId: string | null
  updatedAt: string
}

function isHumanVerdict(
  disposition: DisposeProposalCommandInput['disposition'],
): disposition is z.infer<typeof disposeProposalSchema>['disposition'] {
  return disposition === 'approved' || disposition === 'edited' || disposition === 'rejected'
}

/**
 * Close the workflows review task a disposed proposal no longer needs.
 *
 * `workflows` is an OPTIONAL peer, so the module is reached through a dynamic
 * import inside the try — an installation without it simply has no task to
 * close. Never throws: the verdict is already committed, and a close failure
 * must not turn a completed disposition into a failed request.
 */
async function closeReviewTask(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  options: {
    userTaskId: string
    disposition: AgentProposalDisposition
    closedBy: string | null
    tenantId: string
    organizationId: string
  },
): Promise<void> {
  try {
    const dispositionTask = (await import(
      '@open-mercato/core/modules/workflows/lib/agent-disposition-task'
    )) as typeof import('@open-mercato/core/modules/workflows/lib/agent-disposition-task')
    await dispositionTask.closeAgentDispositionTask(em, container, options)
  } catch (error) {
    logger.warn('review task not closed for a disposed proposal', {
      userTaskId: options.userTaskId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const disposeProposalCommand: CommandHandler<DisposeProposalCommandInput, DisposeProposalCommandResult> = {
  id: 'agent_orchestrator.proposals.dispose',
  async execute(rawInput, ctx) {
    const input = disposeCommandInputSchema.parse(rawInput)
    const isAuto = input.disposition === 'auto_approved'

    // 5. Validate the public verdict input shape for the human path (enforces the
    // edit/reject reason + edit payload superRefine). The internal auto path
    // skips it (it never sends reason/payload).
    if (isHumanVerdict(input.disposition)) {
      disposeProposalSchema.parse({
        disposition: input.disposition,
        payload: input.payload,
        reason: input.reason,
        selectedOptionId: input.selectedOptionId,
      })
    }

    const container = ctx.container
    const actorUserId = input.userId ?? null

    // 1. Mutation guard (before). The auto path runs under a system actor (no end
    // user) — skip the RBAC guard for it; the human path always carries an actor.
    let guardResult: Awaited<ReturnType<typeof validateCrudMutationGuard>> = null
    if (!isAuto && actorUserId) {
      guardResult = await validateCrudMutationGuard(container, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: actorUserId,
        resourceKind: RESOURCE_KIND_GUARD,
        resourceId: input.proposalId,
        operation: 'update',
        requestMethod: ctx.request?.method ?? 'POST',
        requestHeaders: ctx.request?.headers ?? new Headers(),
      })
      if (guardResult && !guardResult.ok) {
        throw new CrudHttpError(guardResult.status, guardResult.body)
      }
    }

    const em = (container.resolve('em') as EntityManager).fork()

    // 2. Load org-scoped (never leak a cross-tenant row).
    const proposal = await findOneWithDecryption(
      em,
      AgentProposal,
      { id: input.proposalId, tenantId: input.tenantId, organizationId: input.organizationId, deletedAt: null },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!proposal) {
      enforceRecordGoneIsConflict({
        resourceKind: RESOURCE_KIND,
        resourceId: input.proposalId,
        request: ctx.request ?? null,
      })
      throw new CrudHttpError(404, { error: '[internal] proposal not found' })
    }

    // An eval replay's proposal is a RECORD of what the agent proposed, never work
    // to execute — an `approved` verdict here would run the payload for real. The
    // caseload list already hides them, but a list filter is not enforcement: the
    // id is reachable from the trace inspector, which renders a run's proposals.
    if (proposal.source === 'eval') {
      throw new CrudHttpError(422, { error: '[internal] eval-replay proposals cannot be disposed' })
    }

    // Capture the agent's ORIGINAL proposal payload before an `edited` verdict
    // overwrites it, so the correction flywheel records what the agent proposed.
    const originalProposalPayload = proposal.payload
    const correctionRunId = proposal.runId
    const correctionAgentId = proposal.agentId
    const correctionProcessId = proposal.processId ?? null
    const correctionStepId = proposal.stepId ?? null

    // 3a. The selected option must be one the AGENT actually offered. Checked against
    // the original payload — for `edited` the incoming payload is the operator's
    // amendment, and an option id that only exists there was never proposed.
    if (input.selectedOptionId) {
      const knownOptionIds = listProposalOptionIds(originalProposalPayload)
      if (!knownOptionIds.includes(input.selectedOptionId)) {
        throw new CrudHttpError(400, {
          error: '[internal] unknown selectedOptionId',
          details: { selectedOptionId: input.selectedOptionId, knownOptionIds },
        })
      }
    }

    // 3. Already-disposed guard. Re-disposing to the same verdict is idempotent;
    // a different verdict on an already-terminal proposal is a genuine conflict.
    if (proposal.disposition !== 'pending') {
      if (proposal.disposition === input.disposition) {
        return {
          proposalId: proposal.id,
          disposition: proposal.disposition,
          dispositionBy: proposal.dispositionBy ?? null,
          selectedOptionId: proposal.selectedOptionId ?? null,
          updatedAt: proposal.updatedAt.toISOString(),
        }
      }
      throw new CrudHttpError(409, { error: '[internal] proposal already disposed' })
    }

    // 4. Optimistic lock on updated_at (human path only — the auto path holds no
    // client token and never raced a stale modal).
    if (!isAuto) {
      enforceCommandOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: proposal.id,
        current: proposal.updatedAt,
        request: ctx.request ?? null,
      })
    }

    const nextDispositionBy = isAuto ? (input.dispositionBy ?? 'rule:threshold') : actorUserId

    // 6. Transition pending → auto_approved | approved | edited | rejected.
    await withAtomicFlush(
      em,
      [
        () => {
          proposal.disposition = input.disposition
          proposal.dispositionBy = nextDispositionBy
          if (input.selectedOptionId) {
            proposal.selectedOptionId = input.selectedOptionId
            // Envelope confidence is the LEADER option's before a verdict and the
            // CHOSEN option's after; the column is what the traces `low-confidence`
            // facet filters on, so it must follow the choice.
            proposal.confidence = deriveEnvelopeConfidence(
              originalProposalPayload,
              input.selectedOptionId,
            )
          }
          if (input.disposition === 'edited') {
            proposal.payload = input.payload
            proposal.dispositionReason = input.reason ?? null
          } else if (input.disposition === 'rejected') {
            proposal.dispositionReason = input.reason ?? null
          }
        },
      ],
      { transaction: true, label: 'agent_orchestrator.proposals.dispose' },
    )

    // 6b. Flush the cached caseload/detail reads. The verdict is committed, but
    // the list route these are read through is a cached CRUD GET whose tags only
    // this write can clear — without it the operator watches the row they just
    // approved sit in their queue as `pending` until the entry expires.
    await invalidateAgentProposalCache(
      container,
      {
        id: proposal.id,
        tenantId: proposal.tenantId,
        organizationId: proposal.organizationId,
      },
      'agent_orchestrator.proposals.dispose',
    )

    // 7. Mutation guard (after) — fire audit + index side effects.
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess && actorUserId) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: actorUserId,
        resourceKind: RESOURCE_KIND_GUARD,
        resourceId: proposal.id,
        operation: 'update',
        requestMethod: ctx.request?.method ?? 'POST',
        requestHeaders: ctx.request?.headers ?? new Headers(),
        metadata: guardResult.metadata ?? null,
      })
    }

    // 8. Emit the audit event for every verdict (rule or human).
    await emitAgentOrchestratorEvent(
      'agent_orchestrator.proposal.disposed',
      {
        proposalId: proposal.id,
        disposition: proposal.disposition,
        dispositionBy: nextDispositionBy,
        // Which alternative the verdict selected (additive; null on a reject).
        selectedOptionId: proposal.selectedOptionId ?? null,
        processId: proposal.processId,
        stepId: proposal.stepId,
        tenantId: proposal.tenantId,
        organizationId: proposal.organizationId,
      },
      { persistent: true },
    )

    // 8b. Correction flywheel: a human edit/reject is a correction — record it
    // (append-only) and auto-draft an eval case. Best-effort: the verdict is
    // already committed, so a correction-write failure must not fail disposition
    // (the explicit POST /corrections route is the fallback recording surface).
    if (!isAuto && actorUserId && (input.disposition === 'edited' || input.disposition === 'rejected')) {
      try {
        const commandBus = container.resolve('commandBus') as CommandBus
        await commandBus.execute('agent_orchestrator.corrections.create', {
          input: {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            proposalId: proposal.id,
            agentRunId: correctionRunId,
            processId: correctionProcessId,
            stepId: correctionStepId,
            agentDefinitionId: correctionAgentId,
            correctedByUserId: actorUserId,
            action: input.disposition === 'edited' ? 'edit' : 'reject',
            proposedValue: originalProposalPayload,
            correctedValue: input.disposition === 'edited' ? input.payload : null,
            reason: input.reason ?? '',
          },
          ctx,
        })
      } catch (error) {
        logger.warn('failed to record correction for disposed proposal', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 8c. Close the review task this proposal raised, if it raised one (A7).
    // Runs on EVERY disposition path — including auto-approve, which sets
    // `skipResume` and therefore never reaches step 9 — because the question
    // "is this decision still outstanding?" is answered by the verdict, not by
    // how the run resumes. Best-effort and after the commit: the verdict is
    // already durable, and a stale open task is a worse outcome than a failed
    // close only if the close can also fail the disposition, which it cannot.
    // It does NOT complete the task through the engine (that would advance the
    // run); resuming is step 9's job and nothing else's.
    if (proposal.userTaskId) {
      await closeReviewTask(container, em, {
        userTaskId: proposal.userTaskId,
        disposition: proposal.disposition,
        closedBy: nextDispositionBy,
        tenantId: proposal.tenantId,
        organizationId: proposal.organizationId,
      })
    }

    // 9. Resume (human path only). The auto path set `skipResume` because the
    // area-02 executor proceeded inline without ever parking — no signal to send,
    // and no `proposal.ready` emitted. Human verdicts on a workflow-originated
    // proposal emit `proposal.ready` and deliver the resume signal.
    if (!isAuto && !input.skipResume && proposal.processId) {
      await resumeWorkflowForProposal(container, em, {
        proposalId: proposal.id,
        processId: proposal.processId,
        stepId: proposal.stepId ?? null,
        disposition: proposal.disposition,
        proposalPayload: proposal.payload,
        tenantId: proposal.tenantId,
        organizationId: proposal.organizationId,
        userId: actorUserId,
      })
    }

    return {
      proposalId: proposal.id,
      disposition: proposal.disposition,
      dispositionBy: nextDispositionBy,
      selectedOptionId: proposal.selectedOptionId ?? null,
      updatedAt: proposal.updatedAt.toISOString(),
    }
  },
}

registerCommand(disposeProposalCommand)

export { disposeProposalCommand }
