import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentTaskDefinition, AgentTaskRun } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { AGENT_ORCHESTRATOR_TASK_RUN_QUEUE, getAgentOrchestratorQueue } from '../lib/queue'
import { jsonSchemaToZod, type JsonSchemaNode } from '../lib/sdk/outcomeSchema'

const enqueueTaskRunSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  taskDefinitionId: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(200).nullable().optional(),
  sourceEntityType: z.string().min(1).max(100).nullable().optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
  /** Provenance: `user:<id>` / `api_key:<id>` / `schedule:<id>` / `event:<name>`. */
  triggeredBy: z.string().min(1).max(150),
})
export type EnqueueTaskRunInput = z.infer<typeof enqueueTaskRunSchema>

export type EnqueueTaskRunResult = { taskRunId: string; status: 'running'; deduplicated: boolean }

/**
 * Validates run input against the definition's optional `inputSchema` (the
 * OUTCOME JSON-Schema subset, compiled to Zod). An uncompilable schema is a
 * definition-config error, not a caller error — logged and skipped so a bad
 * schema can never brick an otherwise valid task.
 */
function validateAgainstInputSchema(definition: AgentTaskDefinition, input: Record<string, unknown>): void {
  if (!definition.inputSchema || typeof definition.inputSchema !== 'object') return
  let compiled
  try {
    compiled = jsonSchemaToZod(definition.inputSchema as JsonSchemaNode)
  } catch (error) {
    console.warn(
      '[internal] agent_orchestrator: task inputSchema failed to compile — skipping validation',
      { taskDefinitionId: definition.id },
      error instanceof Error ? error.message : error,
    )
    return
  }
  const parsed = compiled.safeParse(input)
  if (!parsed.success) {
    throw new CrudHttpError(400, {
      error: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors,
    })
  }
}

/** Merge run-time input over the definition's defaults (input wins per key). */
export function resolveTaskRunInput(
  definition: AgentTaskDefinition,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const defaults =
    definition.inputDefaults && typeof definition.inputDefaults === 'object' && !Array.isArray(definition.inputDefaults)
      ? (definition.inputDefaults as Record<string, unknown>)
      : {}
  return { ...defaults, ...(input ?? {}) }
}

/**
 * The single `/run` side effect all four trigger sources converge on: dedupe on
 * the idempotency key, insert the `AgentTaskRun(status='running')` ledger row,
 * emit `task_run.started` (clientBroadcast), and enqueue `{ taskRunId }` onto
 * the always-async `agent-task-runs` queue. NOT undoable — triggering a run is
 * an action; mistakes are corrected through the underlying proposal/instance
 * disposition paths (spec §Commands & Events).
 */
export const enqueueTaskRunCommand: CommandHandler<EnqueueTaskRunInput, EnqueueTaskRunResult> = {
  id: 'agent_orchestrator.tasks.enqueueRun',
  async execute(rawInput, ctx) {
    const input = enqueueTaskRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    const definition = await findOneWithDecryption(
      em,
      AgentTaskDefinition,
      { id: input.taskDefinitionId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!definition) throw new CrudHttpError(404, { error: 'Task not found' })
    if (!definition.enabled) throw new CrudHttpError(409, { error: 'Task is disabled' })
    if (!definition.executionPrincipalId) {
      throw new CrudHttpError(409, { error: 'Task has no execution principal yet — retry shortly' })
    }

    const resolvedInput = resolveTaskRunInput(definition, input.input)
    validateAgainstInputSchema(definition, resolvedInput)

    if (input.idempotencyKey) {
      const existing = await em.findOne(AgentTaskRun, {
        organizationId: input.organizationId,
        taskDefinitionId: definition.id,
        idempotencyKey: input.idempotencyKey,
      })
      if (existing) {
        return { taskRunId: existing.id, status: 'running', deduplicated: true }
      }
    }

    const run = em.create(AgentTaskRun, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      taskDefinitionId: definition.id,
      targetType: definition.targetType,
      targetAgentId: definition.targetAgentId ?? null,
      targetWorkflowId: definition.targetWorkflowId ?? null,
      status: 'running',
      input: resolvedInput,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
      triggeredBy: input.triggeredBy,
      idempotencyKey: input.idempotencyKey ?? null,
      startedAt: new Date(),
    })
    em.persist(run)
    try {
      await em.flush()
    } catch (error) {
      // Two racing calls with the same idempotency key: the partial unique index
      // rejects the losing insert — return the winner's row instead of erroring.
      if (input.idempotencyKey) {
        const winner = await em.findOne(AgentTaskRun, {
          organizationId: input.organizationId,
          taskDefinitionId: definition.id,
          idempotencyKey: input.idempotencyKey,
        })
        if (winner) return { taskRunId: winner.id, status: 'running', deduplicated: true }
      }
      throw error
    }

    await emitAgentOrchestratorEvent('agent_orchestrator.task_run.started', {
      id: run.id,
      taskDefinitionId: definition.id,
      targetType: run.targetType,
      triggeredBy: run.triggeredBy,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    }, { persistent: true })

    await getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_TASK_RUN_QUEUE).enqueue({ taskRunId: run.id })

    return { taskRunId: run.id, status: 'running', deduplicated: false }
  },
}

registerCommand(enqueueTaskRunCommand)
