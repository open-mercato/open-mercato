import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ProcessDefinition, ProcessInstance } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { AGENT_ORCHESTRATOR_PROCESS_EXECUTION_QUEUE, getAgentOrchestratorQueue } from '../lib/queue'
import { jsonSchemaToZod, type JsonSchemaNode } from '../lib/sdk/outcomeSchema'
import { processRunTriggeredBySchema } from '../data/validators'
import { allowsManualEntry } from '../lib/tasks/triggers'

const logger = createLogger('agent_orchestrator').child({ command: 'processes' })

const startProcessExecutionSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  processDefinitionId: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(200).nullable().optional(),
  sourceEntityType: z.string().min(1).max(100).nullable().optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
  /** WHICH declared trigger fired: `{ kind, ref? }` (see `processRunTriggeredBySchema`). */
  triggeredBy: processRunTriggeredBySchema,
})
export type StartProcessExecutionInput = z.infer<typeof startProcessExecutionSchema>

export type StartProcessExecutionResult = { executionId: string; deduplicated: boolean }

/**
 * Validates start input against the definition's optional `inputSchema` (the
 * OUTCOME JSON-Schema subset, compiled to Zod). An uncompilable schema is a
 * definition-config error, not a caller error — logged and skipped so a bad
 * schema can never brick an otherwise valid definition.
 */
function validateAgainstInputSchema(definition: ProcessDefinition, input: Record<string, unknown>): void {
  if (!definition.inputSchema || typeof definition.inputSchema !== 'object') return
  let compiled
  try {
    compiled = jsonSchemaToZod(definition.inputSchema as JsonSchemaNode)
  } catch (error) {
    logger.warn('process definition inputSchema failed to compile — skipping validation', {
      processDefinitionId: definition.id,
      error: error instanceof Error ? error.message : String(error),
    })
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

/** Merge start input over the definition's defaults (input wins per key). */
export function resolveProcessInput(
  definition: ProcessDefinition,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const defaults =
    definition.inputDefaults && typeof definition.inputDefaults === 'object' && !Array.isArray(definition.inputDefaults)
      ? (definition.inputDefaults as Record<string, unknown>)
      : {}
  return { ...defaults, ...(input ?? {}) }
}

/**
 * The single side effect every trigger source converges on — manual, schedule,
 * event and the external executions API alike. It does NOT start a workflow
 * itself: it claims the idempotency key, records the business-facing execution
 * row, and enqueues. The worker then starts the one and only durable execution,
 * the `WorkflowInstance`.
 *
 * Claiming the key here rather than in the worker is what makes idempotency real:
 * the partial unique index on `(organization_id, process_definition_id,
 * idempotency_key)` rejects the losing insert BEFORE any workflow exists, so one
 * key can never produce two instances no matter how many callers race.
 *
 * NOT undoable — starting an execution is an action; mistakes are corrected
 * through the workflow instance's own cancellation and the proposal disposition
 * paths.
 */
export const startProcessExecutionCommand: CommandHandler<StartProcessExecutionInput, StartProcessExecutionResult> = {
  id: 'agent_orchestrator.processes.startExecution',
  async execute(rawInput, ctx) {
    const input = startProcessExecutionSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    const definition = await findOneWithDecryption(
      em,
      ProcessDefinition,
      { id: input.processDefinitionId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!definition) throw new CrudHttpError(404, { error: 'Process definition not found' })
    if (!definition.enabled) throw new CrudHttpError(409, { error: 'Process definition is disabled' })
    // Manual entry is a DECLARED capability, not an ambient one. Checked here
    // rather than only in the route so every hand-start path converges on one gate.
    if (input.triggeredBy.kind === 'manual' && !allowsManualEntry(definition.triggers)) {
      throw new CrudHttpError(403, {
        error: 'This process declares no manual trigger — add one to start it by hand.',
      })
    }

    const resolvedInput = resolveProcessInput(definition, input.input)
    validateAgainstInputSchema(definition, resolvedInput)

    if (input.idempotencyKey) {
      const existing = await em.findOne(ProcessInstance, {
        organizationId: input.organizationId,
        processDefinitionId: definition.id,
        idempotencyKey: input.idempotencyKey,
      })
      if (existing) return { executionId: existing.id, deduplicated: true }
    }

    const now = new Date()
    const execution = em.create(ProcessInstance, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      processDefinitionId: definition.id,
      workflowId: definition.workflowId,
      status: 'running',
      input: resolvedInput,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId: input.sourceEntityId ?? null,
      triggeredBy: input.triggeredBy,
      idempotencyKey: input.idempotencyKey ?? null,
      openedAt: now,
      lastActivityAt: now,
    })
    em.persist(execution)
    try {
      await em.flush()
    } catch (error) {
      // Two racing calls with the same idempotency key: the partial unique index
      // rejects the losing insert — return the winner's row instead of erroring.
      if (input.idempotencyKey) {
        const winner = await em.findOne(ProcessInstance, {
          organizationId: input.organizationId,
          processDefinitionId: definition.id,
          idempotencyKey: input.idempotencyKey,
        })
        if (winner) return { executionId: winner.id, deduplicated: true }
      }
      throw error
    }

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.process.execution.started',
      {
        id: execution.id,
        processDefinitionId: definition.id,
        workflowId: definition.workflowId,
        triggeredBy: execution.triggeredBy,
        tenantId: execution.tenantId,
        organizationId: execution.organizationId,
      },
      { persistent: true },
    )

    await getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_PROCESS_EXECUTION_QUEUE).enqueue({
      executionId: execution.id,
    })

    return { executionId: execution.id, deduplicated: false }
  },
}

registerCommand(startProcessExecutionCommand)
