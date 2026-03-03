import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernanceDecisionEvent } from '../data/entities'
import { decisionSupersedeSchema, type DecisionSupersedeInput } from '../data/validators'
import { ensureRecordScope, recordCommandDecision, scopeFromContext } from './shared'

const supersedeDecisionCommand: CommandHandler<DecisionSupersedeInput, { decisionEventId: string; supersedesEventId: string }> = {
  id: 'agent_governance.decisions.supersede',
  async execute(rawInput, ctx) {
    const input = decisionSupersedeSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const originalEvent = await findOneWithDecryption(
      em,
      AgentGovernanceDecisionEvent,
      { id: input.id },
      undefined,
      scopeFromContext(ctx),
    )

    if (!originalEvent) {
      throw new CrudHttpError(404, { error: 'Decision event not found.' })
    }

    ensureRecordScope(ctx, originalEvent.tenantId, originalEvent.organizationId)

    const writeSet = {
      ...(originalEvent.writeSet ?? {}),
      ...(input.writeSet ?? {}),
      correctionNote: input.note ?? null,
      supersededEventId: originalEvent.id,
    }

    const decisionResult = await recordCommandDecision(
      ctx,
      {
        tenantId: originalEvent.tenantId,
        organizationId: originalEvent.organizationId,
        runId: originalEvent.runId ?? null,
        stepId: originalEvent.stepId ?? null,
        actionType: originalEvent.actionType,
        targetEntity: originalEvent.targetEntity,
        targetId: originalEvent.targetId ?? null,
        sourceRefs: input.sourceRefs ?? originalEvent.inputEvidence,
        policyId: originalEvent.policyId ?? null,
        riskBandId: originalEvent.riskBandId ?? null,
        riskScore: originalEvent.riskScore ?? null,
        controlPath: 'override',
        approverIds: ctx.auth?.sub ? [ctx.auth.sub] : originalEvent.approverIds,
        exceptionIds: originalEvent.exceptionIds,
        writeSet,
        status: input.status ?? originalEvent.status,
        errorCode: input.errorCode ?? originalEvent.errorCode ?? null,
        harnessProvider: originalEvent.harnessProvider ?? 'open_mercato',
        supersedesEventId: originalEvent.id,
      },
      {
        durability: 'fail_closed',
        repairCode: 'DECISION_SUPERSEDE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    if (!decisionResult.eventId) {
      throw new CrudHttpError(500, { error: 'Failed to persist superseding decision event.' })
    }

    return {
      decisionEventId: decisionResult.eventId,
      supersedesEventId: originalEvent.id,
    }
  },
}

registerCommand(supersedeDecisionCommand)
