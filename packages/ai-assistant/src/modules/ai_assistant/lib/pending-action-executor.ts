/**
 * Pending-action executor (spec §9.4, Step 5.8).
 *
 * Transitions an `AiPendingAction` from `pending → confirmed → executing`,
 * invokes the wrapped tool handler, and records the outcome. Isolated from
 * the HTTP route so the unit suite can exercise the state-machine +
 * event-emission + idempotency guarantees without constructing a
 * `NextRequest`.
 *
 * Atomicity:
 * - The `pending → confirmed` and `confirmed → executing` transitions go
 *   through the repository's `em.transactional` boundary. If the process
 *   crashes between steps, the row is left in an intermediate terminal
 *   state (`executing` or `confirmed`) that the operator can recover —
 *   NEVER in a partially-applied state that hides the crash.
 * - The tool handler itself runs OUTSIDE the repo transaction so that a
 *   long-running write does not hold an `ai_pending_actions` row lock.
 *   The handler's own transaction boundary (typically a command) is the
 *   unit of atomicity for the underlying data change.
 */
import { AiPendingActionRepository } from '../data/repositories/AiPendingActionRepository'
import type { AiPendingAction } from '../data/entities'
import { emitAiAssistantEvent } from '../events'
import type { AiActionConfirmedPayload } from '../events'
import type { AiAgentDefinition } from './ai-agent-definition'
import type { AiToolDefinition, McpToolContext } from './types'
import type {
  AiPendingActionExecutionResult,
  AiPendingActionFailedRecord,
} from './pending-action-types'

export interface PendingActionExecuteContext {
  tenantId: string
  organizationId: string | null
  userId: string
  userFeatures: string[]
  isSuperAdmin: boolean
  container: import('awilix').AwilixContainer
}

export interface PendingActionExecuteInput {
  action: AiPendingAction
  agent: AiAgentDefinition
  tool: AiToolDefinition
  ctx: PendingActionExecuteContext
  /** Carried over from the re-check; written onto the row with status=confirmed. */
  failedRecords?: AiPendingActionFailedRecord[] | null
  repo?: AiPendingActionRepository
  /**
   * Injection seam for unit tests. When omitted, emission is routed via
   * the typed `emitAiAssistantEvent` helper (the normal production path).
   * When supplied, the raw bus is used directly — kept for legacy tests
   * that assert on the bus call surface.
   */
  emitEvent?: (
    eventId: 'ai.action.confirmed',
    payload: AiActionConfirmedPayload,
  ) => Promise<void>
  now?: Date
}

export interface PendingActionExecuteOk {
  ok: true
  action: AiPendingAction
  executionResult: AiPendingActionExecutionResult
}

export interface PendingActionExecuteFail {
  ok: false
  action: AiPendingAction
  executionResult: AiPendingActionExecutionResult
  /** The underlying error — the route translates into a 200 with `executionResult.error` set. */
  cause: unknown
}

export type PendingActionExecuteResult = PendingActionExecuteOk | PendingActionExecuteFail

const CONFIRMED_EVENT_ID = 'ai.action.confirmed' as const

type ConfirmedEmitter = (
  eventId: 'ai.action.confirmed',
  payload: AiActionConfirmedPayload,
) => Promise<void>

const defaultConfirmedEmitter: ConfirmedEmitter = async (eventId, payload) => {
  await emitAiAssistantEvent(eventId, payload as unknown as Record<string, unknown>, {
    persistent: true,
  })
}

async function emitConfirmed(
  emitter: ConfirmedEmitter,
  payload: AiActionConfirmedPayload,
): Promise<void> {
  try {
    await emitter(CONFIRMED_EVENT_ID, payload)
  } catch (error) {
    console.warn(`[AI Pending Action] Failed to emit ${CONFIRMED_EVENT_ID}:`, error)
  }
}

function normalizeExecutionResult(
  raw: unknown,
): AiPendingActionExecutionResult {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const result: AiPendingActionExecutionResult = {}
  if (typeof source.recordId === 'string') result.recordId = source.recordId
  if (typeof source.commandName === 'string') result.commandName = source.commandName
  return result
}

function toToolHandlerContext(ctx: PendingActionExecuteContext): McpToolContext {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    container: ctx.container,
    userFeatures: ctx.userFeatures,
    isSuperAdmin: ctx.isSuperAdmin,
  }
}

/**
 * Idempotent entry point for the Step 5.8 confirm route.
 *
 * - If the action is already `confirmed` with a stored `executionResult`,
 *   returns that prior result without re-invoking the handler (double-click /
 *   retry contract).
 * - If the action is already `confirmed` without a stored `executionResult`
 *   (shouldn't happen in practice), returns a synthesized empty result.
 * - If the action is still `pending`, runs the transitions and the handler.
 * - Any other status is rejected at the re-check layer before this helper
 *   is ever called; this helper treats them as invariant violations.
 */
export async function executePendingActionConfirm(
  input: PendingActionExecuteInput,
): Promise<PendingActionExecuteResult> {
  const { action, agent, tool, ctx, failedRecords, now } = input
  const repo = input.repo ?? new AiPendingActionRepository(ctx.container.resolve('em'))
  const scope = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  }
  const clock = now ?? new Date()
  const emitter: ConfirmedEmitter = input.emitEvent ?? defaultConfirmedEmitter

  if (action.status === 'confirmed') {
    const prior = (action.executionResult ?? {}) as AiPendingActionExecutionResult
    return { ok: true, action, executionResult: prior }
  }

  if (action.status === 'executing') {
    const prior = (action.executionResult ?? {}) as AiPendingActionExecutionResult
    return { ok: true, action, executionResult: prior }
  }

  if (action.status !== 'pending') {
    return {
      ok: false,
      action,
      executionResult: {
        error: { code: 'invalid_status', message: `Action is in status "${action.status}".` },
      },
      cause: new Error(`Action is in status "${action.status}"`),
    }
  }

  const partialFailedRecords =
    Array.isArray(failedRecords) && failedRecords.length > 0 ? failedRecords : null

  const confirmedRow = await repo.setStatus(action.id, 'confirmed', scope, {
    resolvedByUserId: ctx.userId,
    now: clock,
    ...(partialFailedRecords ? { failedRecords: partialFailedRecords } : {}),
  })
  const executingRow = await repo.setStatus(confirmedRow.id, 'executing', scope, { now: clock })

  let handlerOutput: unknown
  try {
    handlerOutput = await tool.handler(action.normalizedInput as never, toToolHandlerContext(ctx))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const failureResult: AiPendingActionExecutionResult = {
      error: { code: 'handler_error', message },
    }
    const failedRow = await repo.setStatus(executingRow.id, 'failed', scope, {
      executionResult: failureResult,
      now: clock,
    })
    await emitConfirmed(emitter, {
      pendingActionId: failedRow.id,
      agentId: agent.id,
      toolName: tool.name,
      status: failedRow.status,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      userId: ctx.userId,
      resolvedByUserId: ctx.userId,
      resolvedAt: (failedRow.resolvedAt ?? clock).toISOString?.() ?? new Date(clock).toISOString(),
      executionResult: failureResult,
    })
    return {
      ok: false,
      action: failedRow,
      executionResult: failureResult,
      cause: error,
    }
  }

  const successResult = normalizeExecutionResult(handlerOutput)
  const confirmedFinal = await repo.setStatus(executingRow.id, 'confirmed', scope, {
    executionResult: successResult,
    now: clock,
  })
  await emitConfirmed(emitter, {
    pendingActionId: confirmedFinal.id,
    agentId: agent.id,
    toolName: tool.name,
    status: confirmedFinal.status,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId ?? null,
    userId: ctx.userId,
    resolvedByUserId: ctx.userId,
    resolvedAt: (confirmedFinal.resolvedAt ?? clock).toISOString?.() ?? new Date(clock).toISOString(),
    executionResult: successResult,
  })
  return { ok: true, action: confirmedFinal, executionResult: successResult }
}

export const PENDING_ACTION_CONFIRMED_EVENT_ID = CONFIRMED_EVENT_ID
