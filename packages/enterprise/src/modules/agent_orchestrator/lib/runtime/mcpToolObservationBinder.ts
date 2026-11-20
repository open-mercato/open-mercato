import { randomUUID } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  McpToolExecutionObserver,
  McpToolExecutionObserverContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-tool-execution-observer'
import {
  bindRunObservation,
  createRunObservationCollector,
  type RunObservationSnapshot,
} from '@open-mercato/shared/lib/ai/run-observation'
import { withAuditCorrelation } from '@open-mercato/shared/lib/commands/auditCorrelationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { AgentRun, AgentSpan } from '../../data/entities'
import { withRuntimeAuditWrite } from '../identity/agentWriteScope'
import {
  TOOL_OBSERVATION_SPAN_NAME,
  buildToolObservationAttributes,
  hasToolObservationReports,
  toolObservationExternalSpanId,
} from '../trace/toolObservation'
import type { AgentRunSessionStore } from './agentRunSessionStore'

const logger = createLogger('agent_orchestrator').child({ component: 'mcp-tool-observation' })

export type ObservedAgentRun = {
  id: string
  tenantId: string
  organizationId: string
  parentRunId: string | null
  workflowInstanceId: string | null
}

export type McpToolObservationBinderDeps = {
  resolveRun?: (sessionId: string) => Promise<ObservedAgentRun | null>
  writeObservation?: (input: ToolObservationWrite) => Promise<void>
  generateId?: () => string
  now?: () => Date
}

export type ToolObservationWrite = {
  run: ObservedAgentRun
  toolName: string
  observationId: string
  startedAt: Date
  endedAt: Date
  status: 'ok' | 'error'
  snapshot: RunObservationSnapshot
}

function reportFailure(error: unknown, code: string, attributes: Record<string, string>): void {
  logger.warn('MCP tool observation step failed', {
    code,
    ...attributes,
    err: error instanceof Error ? error.message : String(error),
  })
  getTelemetryRuntime()?.reportError(error, { module: 'agent_orchestrator', code, attributes })
}

async function resolveRunFromContainer(container: AwilixContainer, sessionId: string): Promise<ObservedAgentRun | null> {
  const store = container.resolve('agentRunSessionStore') as AgentRunSessionStore
  const runId = await store.resolveActiveRunId(sessionId)
  if (!runId) return null
  const em = (container.resolve('em') as EntityManager).fork()
  const run = await findOneWithDecryption(em, AgentRun, { id: runId, deletedAt: null })
  if (!run) return null
  return {
    id: run.id,
    tenantId: run.tenantId,
    organizationId: run.organizationId,
    parentRunId: run.parentRunId ?? null,
    workflowInstanceId: run.workflowInstanceId ?? null,
  }
}

async function writeObservationSpan(container: AwilixContainer, input: ToolObservationWrite): Promise<void> {
  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { agentRunId: input.run.id, tenantId: input.run.tenantId, organizationId: input.run.organizationId }
  const externalSpanId = toolObservationExternalSpanId(input.run.id, input.observationId)
  const existing = await em.count(AgentSpan, { ...scope, externalSpanId })
  if (existing > 0) return
  const sequence = await em.count(AgentSpan, scope)
  const span = em.create(AgentSpan, {
    ...scope,
    externalSpanId,
    sequence,
    name: TOOL_OBSERVATION_SPAN_NAME,
    kind: 'system',
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    status: input.status,
    attributes: buildToolObservationAttributes(input.toolName, input.snapshot),
  })
  em.persist(span)
  await withRuntimeAuditWrite(() => em.flush())
}

function buildAuditCorrelation(run: ObservedAgentRun): Record<string, string> {
  const correlation: Record<string, string> = { agentRunId: run.id }
  if (run.parentRunId) correlation.parentAgentRunId = run.parentRunId
  if (run.workflowInstanceId) correlation.workflowInstanceId = run.workflowInstanceId
  return correlation
}

function isScopeMismatch(ctx: McpToolExecutionObserverContext, run: ObservedAgentRun): boolean {
  if (ctx.tenantId && ctx.tenantId !== run.tenantId) return true
  if (ctx.organizationId && ctx.organizationId !== run.organizationId) return true
  return false
}

/**
 * The `mcpToolExecutionObserver` for OpenCode file agents. Tools run in the
 * `mcp:serve-http` process, outside the runner's async context, so the binder
 * re-establishes the run from the per-run session token: tool writes get the
 * run's audit correlation, and knowledge/retrieval reports land on an
 * idempotent `tool.observation` system span. The run (never the tool args)
 * supplies tenant and organization; an unknown session runs the tool plainly.
 */
export function createMcpToolObservationBinder(
  container: AwilixContainer,
  deps: McpToolObservationBinderDeps = {},
): McpToolExecutionObserver {
  const resolveRun = deps.resolveRun ?? ((sessionId: string) => resolveRunFromContainer(container, sessionId))
  const writeObservation = deps.writeObservation ?? ((input: ToolObservationWrite) => writeObservationSpan(container, input))
  const generateId = deps.generateId ?? randomUUID
  const now = deps.now ?? (() => new Date())

  return {
    async wrap<T>(ctx: McpToolExecutionObserverContext, fn: () => Promise<T>): Promise<T> {
      if (!ctx.sessionId) return fn()
      let run: ObservedAgentRun | null = null
      try {
        run = await resolveRun(ctx.sessionId)
      } catch (error) {
        reportFailure(error, 'mcp_tool_observation_run_resolve_failed', { toolName: ctx.toolName })
        return fn()
      }
      if (!run || isScopeMismatch(ctx, run)) return fn()
      const observedRun = run
      const collector = createRunObservationCollector()
      const startedAt = now()
      let status: 'ok' | 'error' = 'ok'
      try {
        return await bindRunObservation(collector, () => withAuditCorrelation(buildAuditCorrelation(observedRun), fn))
      } catch (error) {
        status = 'error'
        throw error
      } finally {
        const snapshot = collector.snapshot()
        if (hasToolObservationReports(snapshot)) {
          try {
            await writeObservation({
              run: observedRun,
              toolName: ctx.toolName,
              observationId: ctx.correlationId || generateId(),
              startedAt,
              endedAt: now(),
              status,
              snapshot,
            })
          } catch (error) {
            reportFailure(error, 'mcp_tool_observation_write_failed', { toolName: ctx.toolName, runId: observedRun.id })
          }
        }
      }
    },
  }
}
