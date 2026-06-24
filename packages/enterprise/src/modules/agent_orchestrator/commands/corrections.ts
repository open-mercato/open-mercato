import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLock,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentRun, AgentEvalCase } from '../data/entities'
import { correctionAction } from '../data/validators'
import { recordCorrection } from '../lib/trace/correctionService'
import { emitAgentOrchestratorEvent } from '../events'

const EVAL_CASE_RESOURCE = 'agent_orchestrator.eval_case'

// ── corrections.create ──────────────────────────────────────────────────────

const createCorrectionCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  proposalId: z.string().uuid(),
  agentRunId: z.string().uuid().nullable().optional(),
  processId: z.string().uuid().nullable().optional(),
  stepId: z.string().nullable().optional(),
  agentDefinitionId: z.string().min(1),
  correctedByUserId: z.string().uuid(),
  action: correctionAction,
  proposedValue: z.unknown(),
  correctedValue: z.unknown().optional(),
  reason: z.string().min(1),
  /** Run input for the auto-drafted eval case; resolved from the run when absent. */
  evalInput: z.unknown().optional(),
})
export type CreateCorrectionCommandInput = z.infer<typeof createCorrectionCommandSchema>
export type CreateCorrectionCommandResult = { correctionId: string; evalCaseId: string }

const createCorrectionCommand: CommandHandler<CreateCorrectionCommandInput, CreateCorrectionCommandResult> = {
  id: 'agent_orchestrator.corrections.create',
  async execute(rawInput, ctx) {
    const input = createCorrectionCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Resolve the eval-case input from the run when the caller did not supply it.
    let evalInput = input.evalInput
    if (evalInput === undefined && input.agentRunId) {
      const run = await findOneWithDecryption(
        em,
        AgentRun,
        {
          id: input.agentRunId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        },
        undefined,
        { tenantId: input.tenantId, organizationId: input.organizationId },
      )
      evalInput = run?.input ?? null
    }

    const result = await recordCorrection(em, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      proposalId: input.proposalId,
      agentRunId: input.agentRunId ?? null,
      processId: input.processId ?? null,
      stepId: input.stepId ?? null,
      agentDefinitionId: input.agentDefinitionId,
      correctedByUserId: input.correctedByUserId,
      action: input.action,
      proposedValue: input.proposedValue,
      correctedValue: input.correctedValue ?? null,
      reason: input.reason,
      evalInput: evalInput ?? null,
    })

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.proposal.corrected',
      {
        id: result.correctionId,
        proposalId: input.proposalId,
        action: input.action,
        correctedByUserId: input.correctedByUserId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      { persistent: true },
    )
    await emitAgentOrchestratorEvent(
      'agent_orchestrator.eval_case.created',
      {
        id: result.evalCaseId,
        sourceType: 'correction',
        sourceId: result.correctionId,
        agentDefinitionId: input.agentDefinitionId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
      { persistent: true },
    )

    return result
  },
}

// ── evalCases.approve ───────────────────────────────────────────────────────

const approveEvalCaseCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  evalCaseId: z.string().uuid(),
  approvedByUserId: z.string().uuid(),
})
export type ApproveEvalCaseCommandInput = z.infer<typeof approveEvalCaseCommandSchema>
export type ApproveEvalCaseCommandResult = { evalCaseId: string; status: string; updatedAt: string }

const approveEvalCaseCommand: CommandHandler<ApproveEvalCaseCommandInput, ApproveEvalCaseCommandResult> = {
  id: 'agent_orchestrator.evalCases.approve',
  async execute(rawInput, ctx) {
    const input = approveEvalCaseCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const evalCase = await em.findOne(AgentEvalCase, {
      id: input.evalCaseId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    })
    if (!evalCase) {
      enforceRecordGoneIsConflict({
        resourceKind: EVAL_CASE_RESOURCE,
        resourceId: input.evalCaseId,
        request: ctx.request ?? null,
      })
      throw new CrudHttpError(404, { error: '[internal] eval case not found' })
    }

    // Idempotent: approving an already-approved case is a no-op.
    if (evalCase.status === 'approved') {
      return { evalCaseId: evalCase.id, status: evalCase.status, updatedAt: evalCase.updatedAt.toISOString() }
    }
    if (evalCase.status !== 'draft') {
      throw new CrudHttpError(409, { error: '[internal] only draft eval cases can be approved' })
    }

    enforceCommandOptimisticLock({
      resourceKind: EVAL_CASE_RESOURCE,
      resourceId: evalCase.id,
      current: evalCase.updatedAt,
      request: ctx.request ?? null,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          evalCase.status = 'approved'
          evalCase.approvedByUserId = input.approvedByUserId
        },
      ],
      { transaction: true, label: 'agent_orchestrator.evalCases.approve' },
    )

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.eval_case.approved',
      {
        id: evalCase.id,
        agentDefinitionId: evalCase.agentDefinitionId,
        approvedByUserId: input.approvedByUserId,
        tenantId: evalCase.tenantId,
        organizationId: evalCase.organizationId,
      },
      { persistent: true },
    )

    return { evalCaseId: evalCase.id, status: evalCase.status, updatedAt: evalCase.updatedAt.toISOString() }
  },
}

registerCommand(createCorrectionCommand)
registerCommand(approveEvalCaseCommand)

export { createCorrectionCommand, approveEvalCaseCommand }
