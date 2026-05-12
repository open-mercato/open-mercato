/**
 * Pending-action cancel executor (spec §9.4, Step 5.9).
 *
 * Flips an `AiPendingAction` from `pending → cancelled` and emits the
 * typed `ai.action.cancelled` event via `emitAiAssistantEvent`. Unlike
 * {@link executePendingActionConfirm} the tool handler is NEVER invoked —
 * cancellation is a pure state-machine transition plus an event emission.
 * Any other status short-circuits: already-`cancelled` is idempotent (no
 * second emit, same row returned); `confirmed` / `executing` / `failed`
 * are treated as invariant violations and bubble up as 409 via the route.
 *
 * If the row's `expiresAt` is in the past at the time of this call we
 * flip it to `expired` (not `cancelled`) — the Step 5.12 cleanup worker
 * races with this code path and we want a single canonical terminal
 * status for a row that reached its TTL.
 *
 * Idempotency: the caller MUST handle the already-`cancelled` branch
 * BEFORE invoking this helper so the event is emitted exactly once per
 * cancellation.
 */
import { AiPendingActionRepository } from '../data/repositories/AiPendingActionRepository'
import type { AiPendingAction } from '../data/entities'
import { emitAiAssistantEvent } from '../events'
import type {
  AiActionCancelledPayload,
  AiActionExpiredPayload,
  AiAssistantEventId,
} from '../events'
import type { AiPendingActionExecutionResult } from './pending-action-types'

export interface PendingActionCancelContext {
  tenantId: string
  organizationId: string | null
  userId: string
  container: import('awilix').AwilixContainer
}

export type CancelEmitter = (
  eventId: Extract<AiAssistantEventId, 'ai.action.cancelled' | 'ai.action.expired'>,
  payload: AiActionCancelledPayload | AiActionExpiredPayload,
) => Promise<void>

export interface PendingActionCancelInput {
  action: AiPendingAction
  ctx: PendingActionCancelContext
  /** Optional, caller-supplied cancellation reason (already trimmed by the route). */
  reason?: string | null
  repo?: AiPendingActionRepository
  /**
   * Injection seam for unit tests. When omitted, emission is routed via
   * the typed `emitAiAssistantEvent` helper (the normal production path).
   */
  emitEvent?: CancelEmitter
  now?: Date
}

export type PendingActionCancelStatus = 'cancelled' | 'expired'

export interface PendingActionCancelResult {
  row: AiPendingAction
  status: PendingActionCancelStatus
}

const CANCELLED_EVENT_ID = 'ai.action.cancelled' as const
const EXPIRED_EVENT_ID = 'ai.action.expired' as const

const defaultCancelEmitter: CancelEmitter = async (eventId, payload) => {
  await emitAiAssistantEvent(eventId, payload as unknown as Record<string, unknown>, {
    persistent: true,
  })
}

async function emitEventSafe(
  emitter: CancelEmitter,
  eventId: Parameters<CancelEmitter>[0],
  payload: Parameters<CancelEmitter>[1],
): Promise<void> {
  try {
    await emitter(eventId, payload)
  } catch (error) {
    console.warn(`[AI Pending Action] Failed to emit ${eventId}:`, error)
  }
}

/**
 * Atomic `pending → cancelled` transition with TTL-race safety.
 *
 * - If `action.status === 'cancelled'`, returns the current row WITHOUT
 *   emitting a second event. Callers should typically short-circuit on
 *   this branch BEFORE invoking the helper (see the Step 5.9 route).
 * - If `action.expiresAt <= now`, the row is flipped to `expired` and the
 *   `ai.action.expired` event is emitted via the typed
 *   `emitAiAssistantEvent` helper (see `../events`). Returns
 *   `{ status: 'expired' }` so the route can translate to a 409
 *   `expired` envelope.
 * - Otherwise flips `pending → cancelled`, writes `resolvedAt` + the
 *   optional cancellation reason onto `executionResult.error`, and emits
 *   `ai.action.cancelled`.
 *
 * Any status other than `pending` / `cancelled` is treated as an
 * invariant violation — the route returns 409 `invalid_status` before
 * reaching this helper. If the caller invokes the helper on such a row
 * it will throw via the repo's state-machine guard.
 */
export async function executePendingActionCancel(
  input: PendingActionCancelInput,
): Promise<PendingActionCancelResult> {
  const { action, ctx, now } = input
  const repo = input.repo ?? new AiPendingActionRepository(ctx.container.resolve('em'))
  const scope = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  }
  const clock = now ?? new Date()
  const emitter: CancelEmitter = input.emitEvent ?? defaultCancelEmitter

  if (action.status === 'cancelled') {
    return { row: action, status: 'cancelled' }
  }

  const expiresAt =
    action.expiresAt instanceof Date ? action.expiresAt : new Date(action.expiresAt)
  if (expiresAt.getTime() <= clock.getTime()) {
    const expiredRow = await repo.setStatus(action.id, 'expired', scope, { now: clock })
    const resolvedAtIso =
      (expiredRow.resolvedAt ?? clock).toISOString?.() ?? new Date(clock).toISOString()
    const expiresAtIso =
      (expiresAt ?? clock).toISOString?.() ?? new Date(clock).toISOString()
    const expiredPayload: AiActionExpiredPayload = {
      pendingActionId: expiredRow.id,
      agentId: expiredRow.agentId,
      toolName: expiredRow.toolName,
      status: expiredRow.status,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      userId: ctx.userId,
      resolvedByUserId: null,
      resolvedAt: resolvedAtIso,
      expiresAt: expiresAtIso,
      expiredAt: resolvedAtIso,
    }
    await emitEventSafe(emitter, EXPIRED_EVENT_ID, expiredPayload)
    return { row: expiredRow, status: 'expired' }
  }

  const trimmedReason = typeof input.reason === 'string' ? input.reason.trim() : ''
  const executionResult: AiPendingActionExecutionResult = {
    error: {
      code: 'cancelled_by_user',
      message: trimmedReason.length > 0 ? trimmedReason : 'Cancelled by user',
    },
  }

  const cancelledRow = await repo.setStatus(action.id, 'cancelled', scope, {
    resolvedByUserId: ctx.userId,
    executionResult,
    now: clock,
  })
  const cancelledPayload: AiActionCancelledPayload = {
    pendingActionId: cancelledRow.id,
    agentId: cancelledRow.agentId,
    toolName: cancelledRow.toolName,
    status: cancelledRow.status,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId ?? null,
    userId: ctx.userId,
    resolvedByUserId: ctx.userId,
    resolvedAt: (cancelledRow.resolvedAt ?? clock).toISOString?.() ?? new Date(clock).toISOString(),
    executionResult,
    ...(trimmedReason.length > 0 ? { reason: trimmedReason } : {}),
  }
  await emitEventSafe(emitter, CANCELLED_EVENT_ID, cancelledPayload)

  return { row: cancelledRow, status: 'cancelled' }
}

export const PENDING_ACTION_CANCELLED_EVENT_ID = CANCELLED_EVENT_ID
export const PENDING_ACTION_EXPIRED_EVENT_ID = EXPIRED_EVENT_ID
