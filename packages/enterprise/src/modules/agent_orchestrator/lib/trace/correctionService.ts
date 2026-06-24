import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentCorrection, AgentEvalCase, type CorrectionAction } from '../../data/entities'

export type RecordCorrectionInput = {
  tenantId: string
  organizationId: string
  proposalId: string
  agentRunId?: string | null
  processId?: string | null
  stepId?: string | null
  agentDefinitionId: string
  correctedByUserId: string
  action: CorrectionAction
  /** The agent's original proposal payload. */
  proposedValue: unknown
  /** Human-supplied corrected payload; null/undefined on a plain reject. */
  correctedValue?: unknown | null
  /** Mandatory, non-empty (enforced again here as a backstop to the Zod gate). */
  reason: string
  /** Run input copied into the auto-drafted eval case (the regression case input). */
  evalInput: unknown
  processType?: string | null
}

export type RecordCorrectionResult = { correctionId: string; evalCaseId: string }

/**
 * Record an append-only `AgentCorrection` and auto-draft an `AgentEvalCase`
 * (status `draft`) from it — the flywheel's write step. Pure over the
 * EntityManager (no command bus / request scope) so it is unit-testable and
 * reusable by both the disposition hook and the explicit corrections route.
 */
export async function recordCorrection(
  em: EntityManager,
  input: RecordCorrectionInput,
): Promise<RecordCorrectionResult> {
  const reason = input.reason?.trim()
  if (!reason) throw new Error('[internal] correction reason is required')

  const correction = em.create(AgentCorrection, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    processId: input.processId ?? null,
    stepId: input.stepId ?? null,
    agentRunId: input.agentRunId ?? null,
    proposalId: input.proposalId,
    correctedByUserId: input.correctedByUserId,
    action: input.action,
    proposedValue: input.proposedValue,
    correctedValue: input.correctedValue ?? null,
    reason,
  })
  em.persist(correction)
  await em.flush()

  const evalCase = em.create(AgentEvalCase, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    sourceType: 'correction',
    sourceId: correction.id,
    agentDefinitionId: input.agentDefinitionId,
    processType: input.processType ?? null,
    input: input.evalInput,
    expected: input.correctedValue ?? null,
    status: 'draft',
  })
  em.persist(evalCase)
  await em.flush()

  correction.evalCaseId = evalCase.id
  await em.flush()

  return { correctionId: correction.id, evalCaseId: evalCase.id }
}
