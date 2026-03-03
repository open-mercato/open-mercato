import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernanceApprovalTask, AgentGovernanceRun } from '../data/entities'
import { approvalDecisionSchema, type ApprovalDecisionInput } from '../data/validators'
import { emitAgentGovernanceEvent } from '../events'
import type { RunOrchestratorService } from '../services/run-orchestrator-service'
import type { TelemetryService } from '../services/telemetry-service'
import { ensureRecordScope, resolveHarnessProvider, scopeFromContext } from './shared'
import { ApprovalStateError, toCrudHttpError } from '../lib/domain-errors'

const approveCommand: CommandHandler<ApprovalDecisionInput, { approvalTaskId: string; runId: string }> = {
  id: 'agent_governance.approvals.approve',
  async execute(rawInput, ctx) {
    const input = approvalDecisionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const task = await findOneWithDecryption(
      em,
      AgentGovernanceApprovalTask,
      { id: input.id },
      { populate: ['run'] },
      scopeFromContext(ctx),
    )
    if (!task) throw new CrudHttpError(404, { error: 'Approval task not found.' })

    ensureRecordScope(ctx, task.tenantId, task.organizationId)

    if (task.status !== 'pending') {
      if (input.idempotencyKey && task.resolutionIdempotencyKey === input.idempotencyKey && task.status === 'approved') {
        const run = task.run as AgentGovernanceRun
        return { approvalTaskId: task.id, runId: run.id }
      }
      throw toCrudHttpError(new ApprovalStateError('Only pending approvals can be approved.'))
    }

    task.status = 'approved'
    task.resolutionIdempotencyKey = input.idempotencyKey ?? null
    task.reviewerUserId = ctx.auth?.sub ?? null
    task.reviewComment = input.comment ?? null
    task.reviewedAt = new Date()
    task.updatedAt = new Date()

    const run = task.run as AgentGovernanceRun
    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const transition = await runOrchestrator.transitionRun(run, 'running', {
      reason: null,
      actorUserId: task.reviewerUserId ?? null,
      controlPath: 'checkpoint',
    })

    const telemetryService = ctx.container.resolve('agentGovernanceTelemetryService') as TelemetryService
    const telemetryRecord = await telemetryService.recordDecision({
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      runId: run.id,
      actionType: run.actionType,
      targetEntity: run.targetEntity,
      targetId: run.targetId ?? null,
      sourceRefs: [],
      policyId: run.policyId ?? null,
      riskBandId: run.riskBandId ?? null,
      riskScore: null,
      controlPath: 'checkpoint',
      approverIds: task.reviewerUserId ? [task.reviewerUserId] : [],
      exceptionIds: [],
      writeSet: {
        approvalTaskId: task.id,
        decision: 'approved',
      },
      status: 'success',
      harnessProvider: resolveHarnessProvider(ctx),
      supersedesEventId: task.decisionEventId ?? null,
    })
    task.decisionEventId = telemetryRecord.eventId

    await em.flush()

    await emitAgentGovernanceEvent('agent_governance.approval.approved', {
      id: task.id,
      runId: run.id,
      reviewerUserId: task.reviewerUserId,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    })
    await emitAgentGovernanceEvent('agent_governance.approval.resolved', {
      id: task.id,
      runId: run.id,
      status: task.status,
      reviewerUserId: task.reviewerUserId,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    })

    await emitAgentGovernanceEvent('agent_governance.run.resumed', {
      id: run.id,
      status: run.status,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    })

    if (transition.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: transition.telemetryEventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (telemetryRecord.eventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: telemetryRecord.eventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (transition.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: run.id,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    return { approvalTaskId: task.id, runId: run.id }
  },
}

const rejectCommand: CommandHandler<ApprovalDecisionInput, { approvalTaskId: string; runId: string }> = {
  id: 'agent_governance.approvals.reject',
  async execute(rawInput, ctx) {
    const input = approvalDecisionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const task = await findOneWithDecryption(
      em,
      AgentGovernanceApprovalTask,
      { id: input.id },
      { populate: ['run'] },
      scopeFromContext(ctx),
    )
    if (!task) throw new CrudHttpError(404, { error: 'Approval task not found.' })

    ensureRecordScope(ctx, task.tenantId, task.organizationId)

    if (task.status !== 'pending') {
      if (input.idempotencyKey && task.resolutionIdempotencyKey === input.idempotencyKey && task.status === 'rejected') {
        const run = task.run as AgentGovernanceRun
        return { approvalTaskId: task.id, runId: run.id }
      }
      throw toCrudHttpError(new ApprovalStateError('Only pending approvals can be rejected.'))
    }

    task.status = 'rejected'
    task.resolutionIdempotencyKey = input.idempotencyKey ?? null
    task.reviewerUserId = ctx.auth?.sub ?? null
    task.reviewComment = input.comment ?? null
    task.reviewedAt = new Date()
    task.updatedAt = new Date()

    const run = task.run as AgentGovernanceRun
    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const transition = await runOrchestrator.transitionRun(run, 'terminated', {
      reason: 'Approval rejected',
      actorUserId: task.reviewerUserId ?? null,
      controlPath: 'rejected',
    })

    const telemetryService = ctx.container.resolve('agentGovernanceTelemetryService') as TelemetryService
    const telemetryRecord = await telemetryService.recordDecision({
      tenantId: task.tenantId,
      organizationId: task.organizationId,
      runId: run.id,
      actionType: run.actionType,
      targetEntity: run.targetEntity,
      targetId: run.targetId ?? null,
      sourceRefs: [],
      policyId: run.policyId ?? null,
      riskBandId: run.riskBandId ?? null,
      riskScore: null,
      controlPath: 'rejected',
      approverIds: task.reviewerUserId ? [task.reviewerUserId] : [],
      exceptionIds: [],
      writeSet: {
        approvalTaskId: task.id,
        decision: 'rejected',
      },
      status: 'blocked',
      harnessProvider: resolveHarnessProvider(ctx),
      errorCode: 'APPROVAL_REJECTED',
      supersedesEventId: task.decisionEventId ?? null,
    })
    task.decisionEventId = telemetryRecord.eventId

    await em.flush()

    await emitAgentGovernanceEvent('agent_governance.approval.rejected', {
      id: task.id,
      runId: run.id,
      reviewerUserId: task.reviewerUserId,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    })
    await emitAgentGovernanceEvent('agent_governance.approval.resolved', {
      id: task.id,
      runId: run.id,
      status: task.status,
      reviewerUserId: task.reviewerUserId,
      tenantId: task.tenantId,
      organizationId: task.organizationId,
    })

    await emitAgentGovernanceEvent('agent_governance.run.terminated', {
      id: run.id,
      status: run.status,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    })

    if (transition.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: transition.telemetryEventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (telemetryRecord.eventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: telemetryRecord.eventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (transition.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: run.id,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    return { approvalTaskId: task.id, runId: run.id }
  },
}

registerCommand(approveCommand)
registerCommand(rejectCommand)
