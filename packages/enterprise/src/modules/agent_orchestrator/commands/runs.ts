import { randomUUID } from 'node:crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentRun, type AgentRunStatus } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { getRerunOfRunId } from '../lib/runtime/rerunContext'

const createAgentRunSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentId: z.string().min(1),
  input: z.unknown(),
  /** Parent run id for a nested sub-agent run (Phase 4); null/absent for top-level runs. */
  parentRunId: z.string().uuid().nullable().optional(),
  /**
   * Runtime that produced this run; half of the trace-ingestion idempotency key
   * `(runtime, externalRunId)`. Stamped at creation so a later trace POST for the
   * same run upserts THIS row instead of creating a duplicate. Optional + nullable
   * so existing callers keep compiling.
   */
  runtime: z.string().min(1).nullable().optional(),
  /** Runtime-native run id; the other half of the ingestion idempotency key. */
  externalRunId: z.string().min(1).nullable().optional(),
  /**
   * Native runtime (spec decision H2): when true and no `externalRunId` is
   * supplied, the command pre-generates the run's uuid and stamps
   * `externalRunId = id` in the SAME insert, so a later trace ingest for
   * `(runtime, externalRunId=runId)` upserts THIS row instead of creating a
   * shadow duplicate. Additive; ignored when an explicit `externalRunId` is set.
   */
  stampExternalRunIdFromId: z.boolean().optional(),
  /** Declared model id; stamped so the cockpit can show/filter runs by model. Null when the agent uses the tenant default. */
  model: z.string().min(1).max(100).nullable().optional(),
  /** Workflow process instance id this run belongs to (INVOKE_AGENT step); links the run to the process in traces. */
  processId: z.string().uuid().nullable().optional(),
  /** Workflow step id this run belongs to. */
  stepId: z.string().min(1).nullable().optional(),
})
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>

const completeAgentRunSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['ok', 'error']),
  output: z.unknown().optional(),
  resultKind: z.enum(['informative', 'actionable']).nullable().optional(),
})
export type CompleteAgentRunInput = z.infer<typeof completeAgentRunSchema>

const failAgentRunSchema = z.object({
  runId: z.string().uuid(),
  errorMessage: z.string(),
})
export type FailAgentRunInput = z.infer<typeof failAgentRunSchema>

export const createAgentRunCommand: CommandHandler<CreateAgentRunInput, { runId: string }> = {
  id: 'agent_orchestrator.runs.create',
  async execute(rawInput, ctx) {
    const input = createAgentRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const selfStampedId =
      input.stampExternalRunIdFromId && !input.externalRunId ? randomUUID() : null
    const run = em.create(AgentRun, {
      ...(selfStampedId ? { id: selfStampedId } : {}),
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      status: 'running' as AgentRunStatus,
      input: input.input,
      parentRunId: input.parentRunId ?? null,
      // Re-run lineage: only the top-level run of a trace-inspector re-run is
      // stamped; nested delegations carry parentRunId and skip it.
      rerunOfRunId: input.parentRunId ? null : getRerunOfRunId() ?? null,
      runtime: input.runtime ?? null,
      externalRunId: selfStampedId ?? input.externalRunId ?? null,
      model: input.model ?? null,
      processId: input.processId ?? null,
      stepId: input.stepId ?? null,
    })
    em.persist(run)
    await em.flush()

    await emitAgentOrchestratorEvent('agent_orchestrator.run.created', {
      id: run.id,
      agentId: run.agentId,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    }, { persistent: true })

    return { runId: run.id }
  },
}

export const completeAgentRunCommand: CommandHandler<CompleteAgentRunInput, { runId: string }> = {
  id: 'agent_orchestrator.runs.complete',
  async execute(rawInput, ctx) {
    const input = completeAgentRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(AgentRun, { id: input.runId })
    if (!run) throw new Error(`[internal] agent run not found: ${input.runId}`)
    run.status = input.status
    run.output = input.output ?? null
    run.resultKind = input.resultKind ?? null
    // Forensic fact: stamped once at the terminal transition, never overwritten
    // (same flush as the status change — atomic per row).
    if (!run.completedAt) run.completedAt = new Date()
    run.updatedAt = new Date()
    await em.flush()

    await emitAgentOrchestratorEvent('agent_orchestrator.run.completed', {
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      resultKind: run.resultKind,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    }, { persistent: true })

    return { runId: run.id }
  },
}

export const failAgentRunCommand: CommandHandler<FailAgentRunInput, { runId: string }> = {
  id: 'agent_orchestrator.runs.fail',
  async execute(rawInput, ctx) {
    const input = failAgentRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(AgentRun, { id: input.runId })
    if (!run) throw new Error(`[internal] agent run not found: ${input.runId}`)
    run.status = 'error'
    run.errorMessage = input.errorMessage
    if (!run.completedAt) run.completedAt = new Date()
    run.updatedAt = new Date()
    await em.flush()

    await emitAgentOrchestratorEvent('agent_orchestrator.run.completed', {
      id: run.id,
      agentId: run.agentId,
      status: run.status,
      errorMessage: run.errorMessage,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    }, { persistent: true })

    return { runId: run.id }
  },
}

registerCommand(createAgentRunCommand)
registerCommand(completeAgentRunCommand)
registerCommand(failAgentRunCommand)
