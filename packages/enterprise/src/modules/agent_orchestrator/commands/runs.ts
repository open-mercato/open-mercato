import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentRun, type AgentRunStatus } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'

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

const createAgentRunCommand: CommandHandler<CreateAgentRunInput, { runId: string }> = {
  id: 'agent_orchestrator.runs.create',
  async execute(rawInput, ctx) {
    const input = createAgentRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = em.create(AgentRun, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      status: 'running' as AgentRunStatus,
      input: input.input,
      parentRunId: input.parentRunId ?? null,
      runtime: input.runtime ?? null,
      externalRunId: input.externalRunId ?? null,
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

const completeAgentRunCommand: CommandHandler<CompleteAgentRunInput, { runId: string }> = {
  id: 'agent_orchestrator.runs.complete',
  async execute(rawInput, ctx) {
    const input = completeAgentRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(AgentRun, { id: input.runId })
    if (!run) throw new Error(`[internal] agent run not found: ${input.runId}`)
    run.status = input.status
    run.output = input.output ?? null
    run.resultKind = input.resultKind ?? null
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

const failAgentRunCommand: CommandHandler<FailAgentRunInput, { runId: string }> = {
  id: 'agent_orchestrator.runs.fail',
  async execute(rawInput, ctx) {
    const input = failAgentRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(AgentRun, { id: input.runId })
    if (!run) throw new Error(`[internal] agent run not found: ${input.runId}`)
    run.status = 'error'
    run.errorMessage = input.errorMessage
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
