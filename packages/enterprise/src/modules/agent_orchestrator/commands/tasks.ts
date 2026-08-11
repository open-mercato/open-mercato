import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProcessDefinition, AgentProcessRun } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE, getAgentOrchestratorQueue } from '../lib/queue'
import { jsonSchemaToZod, type JsonSchemaNode } from '../lib/sdk/outcomeSchema'

const logger = createLogger('agent_orchestrator').child({ command: 'process-definitions' })

const enqueueProcessRunSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  processDefinitionId: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(200).nullable().optional(),
  sourceEntityType: z.string().min(1).max(100).nullable().optional(),
  sourceEntityId: z.string().uuid().nullable().optional(),
  /** Provenance: `user:<id>` / `api_key:<id>` / `schedule:<id>` / `event:<name>`. */
  triggeredBy: z.string().min(1).max(150),
})
export type EnqueueProcessRunInput = z.infer<typeof enqueueProcessRunSchema>

export type EnqueueProcessRunResult = { processRunId: string; status: 'running'; deduplicated: boolean }

/**
 * Validates run input against the definition's optional `inputSchema` (the
 * OUTCOME JSON-Schema subset, compiled to Zod). An uncompilable schema is a
 * definition-config error, not a caller error — logged and skipped so a bad
 * schema can never brick an otherwise valid definition.
 */
function validateAgainstInputSchema(definition: AgentProcessDefinition, input: Record<string, unknown>): void {
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

/** Merge run-time input over the definition's defaults (input wins per key). */
export function resolveProcessRunInput(
  definition: AgentProcessDefinition,
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
 * the idempotency key, insert the `AgentProcessRun(status='running')` ledger row,
 * emit `process_run.started` (clientBroadcast), and enqueue `{ processRunId }` onto
 * the always-async `agent-process-runs` queue. NOT undoable — triggering a run is
 * an action; mistakes are corrected through the underlying proposal/instance
 * disposition paths (spec §Commands & Events).
 */
export const enqueueProcessRunCommand: CommandHandler<EnqueueProcessRunInput, EnqueueProcessRunResult> = {
  id: 'agent_orchestrator.processes.enqueueRun',
  async execute(rawInput, ctx) {
    const input = enqueueProcessRunSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }

    const definition = await findOneWithDecryption(
      em,
      AgentProcessDefinition,
      { id: input.processDefinitionId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!definition) throw new CrudHttpError(404, { error: 'Process definition not found' })
    if (!definition.enabled) throw new CrudHttpError(409, { error: 'Process definition is disabled' })
    if (!definition.executionPrincipalId) {
      throw new CrudHttpError(409, { error: 'Process definition has no execution principal yet — retry shortly' })
    }

    const resolvedInput = resolveProcessRunInput(definition, input.input)
    validateAgainstInputSchema(definition, resolvedInput)

    if (input.idempotencyKey) {
      const existing = await em.findOne(AgentProcessRun, {
        organizationId: input.organizationId,
        processDefinitionId: definition.id,
        idempotencyKey: input.idempotencyKey,
      })
      if (existing) {
        return { processRunId: existing.id, status: 'running', deduplicated: true }
      }
    }

    const run = em.create(AgentProcessRun, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      processDefinitionId: definition.id,
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
        const winner = await em.findOne(AgentProcessRun, {
          organizationId: input.organizationId,
          processDefinitionId: definition.id,
          idempotencyKey: input.idempotencyKey,
        })
        if (winner) return { processRunId: winner.id, status: 'running', deduplicated: true }
      }
      throw error
    }

    await emitAgentOrchestratorEvent('agent_orchestrator.process_run.started', {
      id: run.id,
      processDefinitionId: definition.id,
      targetType: run.targetType,
      triggeredBy: run.triggeredBy,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
    }, { persistent: true })

    await getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE).enqueue({ processRunId: run.id })

    return { processRunId: run.id, status: 'running', deduplicated: false }
  },
}

registerCommand(enqueueProcessRunCommand)
