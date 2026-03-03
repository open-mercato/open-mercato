import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernanceApprovalTask, AgentGovernanceRun } from '../data/entities'
import {
  runRerouteSchema,
  runControlSchema,
  runStartSchema,
  type RunControlInput,
  type RunRerouteInput,
  type RunStartInput,
} from '../data/validators'
import { emitAgentGovernanceEvent } from '../events'
import { PolicyViolationError, toCrudHttpError } from '../lib/domain-errors'
import type { RunOrchestratorService } from '../services/run-orchestrator-service'
import { ensureRecordScope, ensureTenantScope, scopeFromContext } from './shared'

const startRunCommand: CommandHandler<
  RunStartInput,
  {
    runId: string
    approvalTaskId: string | null
    checkpointReasons: string[]
    telemetryEventId: string | null
    telemetryRepairRequired: boolean
  }
> = {
  id: 'agent_governance.runs.start',
  async execute(rawInput, ctx) {
    const input = runStartSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureRecordScope(ctx, input.tenantId, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (input.idempotencyKey) {
      const existingRun = await findOneWithDecryption(
        em,
        AgentGovernanceRun,
        {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey,
        },
        undefined,
        scopeFromContext(ctx),
      )
      if (existingRun) {
        const pendingApprovalTask = await findOneWithDecryption(
          em,
          AgentGovernanceApprovalTask,
          {
            run: existingRun.id,
            status: 'pending',
          },
          undefined,
          scopeFromContext(ctx),
        )
        return {
          runId: existingRun.id,
          approvalTaskId: pendingApprovalTask?.id ?? null,
          checkpointReasons: [],
          telemetryEventId: null,
          telemetryRepairRequired: false,
        }
      }
    }

    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const result = await runOrchestrator.startRun(input, ctx.auth?.sub ?? null)

    await emitAgentGovernanceEvent('agent_governance.run.started', {
      id: result.run.id,
      status: result.run.status,
      tenantId: result.run.tenantId,
      organizationId: result.run.organizationId,
      approvalTaskId: result.approvalTaskId,
    })

    if (result.checkpointReasons.length > 0) {
      await emitAgentGovernanceEvent('agent_governance.run.checkpoint_reached', {
        id: result.run.id,
        status: result.run.status,
        checkpointReasons: result.checkpointReasons,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    if (result.approvalTaskId) {
      await emitAgentGovernanceEvent('agent_governance.approval.requested', {
        runId: result.run.id,
        approvalTaskId: result.approvalTaskId,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    if (result.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: result.telemetryEventId,
        runId: result.run.id,
        actionType: result.run.actionType,
        targetEntity: result.run.targetEntity,
        targetId: result.run.targetId ?? null,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    if (result.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: result.run.id,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    return {
      runId: result.run.id,
      approvalTaskId: result.approvalTaskId,
      checkpointReasons: result.checkpointReasons,
      telemetryEventId: result.telemetryEventId,
      telemetryRepairRequired: result.telemetryRepairRequired,
    }
  },
}

const pauseRunCommand: CommandHandler<RunControlInput, { runId: string; status: string }> = {
  id: 'agent_governance.runs.pause',
  async execute(rawInput, ctx) {
    const input = runControlSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const run = await findOneWithDecryption(
      em,
      AgentGovernanceRun,
      { id: input.id },
      undefined,
      scopeFromContext(ctx),
    )
    if (!run) throw new CrudHttpError(404, { error: 'Run not found.' })

    ensureRecordScope(ctx, run.tenantId, run.organizationId)
    if (input.expectedStatus && run.status !== input.expectedStatus) {
      throw toCrudHttpError(
        new PolicyViolationError(
          `Run status changed from expected ${input.expectedStatus} to ${run.status}. Refresh and retry.`,
          'RUN_CONCURRENCY_CONFLICT',
        ),
      )
    }

    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const result = await runOrchestrator.transitionRun(run, 'paused', {
      reason: input.reason ?? null,
      actorUserId: ctx.auth?.sub ?? null,
      controlPath: 'override',
    })

    await emitAgentGovernanceEvent('agent_governance.run.paused', {
      id: run.id,
      status: run.status,
      reason: input.reason ?? null,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    })

    if (result.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: result.telemetryEventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (result.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: run.id,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    return { runId: run.id, status: run.status }
  },
}

const resumeRunCommand: CommandHandler<RunControlInput, { runId: string; status: string }> = {
  id: 'agent_governance.runs.resume',
  async execute(rawInput, ctx) {
    const input = runControlSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const run = await findOneWithDecryption(
      em,
      AgentGovernanceRun,
      { id: input.id },
      undefined,
      scopeFromContext(ctx),
    )
    if (!run) throw new CrudHttpError(404, { error: 'Run not found.' })

    ensureRecordScope(ctx, run.tenantId, run.organizationId)
    if (input.expectedStatus && run.status !== input.expectedStatus) {
      throw toCrudHttpError(
        new PolicyViolationError(
          `Run status changed from expected ${input.expectedStatus} to ${run.status}. Refresh and retry.`,
          'RUN_CONCURRENCY_CONFLICT',
        ),
      )
    }

    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const result = await runOrchestrator.transitionRun(run, 'running', {
      reason: null,
      actorUserId: ctx.auth?.sub ?? null,
      controlPath: 'override',
    })

    await emitAgentGovernanceEvent('agent_governance.run.resumed', {
      id: run.id,
      status: run.status,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    })

    if (result.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: result.telemetryEventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (result.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: run.id,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    return { runId: run.id, status: run.status }
  },
}

const terminateRunCommand: CommandHandler<RunControlInput, { runId: string; status: string }> = {
  id: 'agent_governance.runs.terminate',
  async execute(rawInput, ctx) {
    const input = runControlSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const run = await findOneWithDecryption(
      em,
      AgentGovernanceRun,
      { id: input.id },
      undefined,
      scopeFromContext(ctx),
    )
    if (!run) throw new CrudHttpError(404, { error: 'Run not found.' })

    ensureRecordScope(ctx, run.tenantId, run.organizationId)
    if (input.expectedStatus && run.status !== input.expectedStatus) {
      throw toCrudHttpError(
        new PolicyViolationError(
          `Run status changed from expected ${input.expectedStatus} to ${run.status}. Refresh and retry.`,
          'RUN_CONCURRENCY_CONFLICT',
        ),
      )
    }

    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const result = await runOrchestrator.transitionRun(run, 'terminated', {
      reason: input.reason ?? 'Terminated by operator',
      actorUserId: ctx.auth?.sub ?? null,
      controlPath: 'override',
    })

    await emitAgentGovernanceEvent('agent_governance.run.terminated', {
      id: run.id,
      status: run.status,
      reason: input.reason ?? null,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    })

    if (result.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: result.telemetryEventId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    if (result.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: run.id,
        tenantId: run.tenantId,
        organizationId: run.organizationId,
      })
    }

    return { runId: run.id, status: run.status }
  },
}

const rerouteRunCommand: CommandHandler<
  RunRerouteInput,
  {
    runId: string
    status: string
    approvalTaskId: string | null
    checkpointReasons: string[]
    telemetryEventId: string | null
    telemetryRepairRequired: boolean
  }
> = {
  id: 'agent_governance.runs.reroute',
  async execute(rawInput, ctx) {
    const input = runRerouteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const run = await findOneWithDecryption(
      em,
      AgentGovernanceRun,
      { id: input.id },
      undefined,
      scopeFromContext(ctx),
    )
    if (!run) throw new CrudHttpError(404, { error: 'Run not found.' })

    ensureRecordScope(ctx, run.tenantId, run.organizationId)
    if (input.expectedStatus && run.status !== input.expectedStatus) {
      throw toCrudHttpError(
        new PolicyViolationError(
          `Run status changed from expected ${input.expectedStatus} to ${run.status}. Refresh and retry.`,
          'RUN_CONCURRENCY_CONFLICT',
        ),
      )
    }

    const runOrchestrator = ctx.container.resolve('agentGovernanceRunOrchestratorService') as RunOrchestratorService
    const result = await runOrchestrator.rerouteRun(run, input, ctx.auth?.sub ?? null)

    await emitAgentGovernanceEvent('agent_governance.run.rerouted', {
      id: run.id,
      status: result.run.status,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
      approvalTaskId: result.approvalTaskId,
      checkpointReasons: result.checkpointReasons,
    })

    if (result.approvalTaskId) {
      await emitAgentGovernanceEvent('agent_governance.approval.requested', {
        runId: result.run.id,
        approvalTaskId: result.approvalTaskId,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
      await emitAgentGovernanceEvent('agent_governance.run.checkpoint_reached', {
        id: result.run.id,
        status: result.run.status,
        checkpointReasons: result.checkpointReasons,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    if (result.telemetryEventId) {
      await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
        eventId: result.telemetryEventId,
        runId: result.run.id,
        actionType: result.run.actionType,
        targetEntity: result.run.targetEntity,
        targetId: result.run.targetId ?? null,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    if (result.telemetryRepairRequired) {
      await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
        runId: result.run.id,
        tenantId: result.run.tenantId,
        organizationId: result.run.organizationId,
      })
    }

    return {
      runId: result.run.id,
      status: result.run.status,
      approvalTaskId: result.approvalTaskId,
      checkpointReasons: result.checkpointReasons,
      telemetryEventId: result.telemetryEventId,
      telemetryRepairRequired: result.telemetryRepairRequired,
    }
  },
}

registerCommand(startRunCommand)
registerCommand(pauseRunCommand)
registerCommand(resumeRunCommand)
registerCommand(terminateRunCommand)
registerCommand(rerouteRunCommand)
