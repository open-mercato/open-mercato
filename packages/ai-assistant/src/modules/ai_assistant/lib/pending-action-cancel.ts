/**
 * Pending-action cancel executor (spec §9.4, Step 5.9).
 *
 * Flips an `AiPendingAction` from `pending → cancelled` and emits the
 * `ai.action.cancelled` event. Unlike
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
import type { AiPendingActionExecutionResult } from './pending-action-types'

export interface PendingActionCancelContext {
  tenantId: string
  organizationId: string | null
  userId: string
  container: import('awilix').AwilixContainer
}

export interface PendingActionCancelInput {
  action: AiPendingAction
  ctx: PendingActionCancelContext
  /** Optional, caller-supplied cancellation reason (already trimmed by the route). */
  reason?: string | null
  repo?: AiPendingActionRepository
  /** Injection seam for unit tests. */
  eventBus?: { emitEvent: (id: string, payload: unknown, options?: unknown) => Promise<void> } | null
  now?: Date
}

export type PendingActionCancelStatus = 'cancelled' | 'expired'

export interface PendingActionCancelResult {
  row: AiPendingAction
  status: PendingActionCancelStatus
}

const CANCELLED_EVENT_ID = 'ai.action.cancelled'
const EXPIRED_EVENT_ID = 'ai.action.expired'

function resolveEventBus(
  container: PendingActionCancelContext['container'],
): { emitEvent: (id: string, payload: unknown, options?: unknown) => Promise<void> } | null {
  if (!container) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return container.resolve('eventBus') as any
  } catch {
    return null
  }
}

async function emitEventSafe(
  bus: { emitEvent: (id: string, payload: unknown, options?: unknown) => Promise<void> } | null,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!bus) return
  try {
    // TODO(step 5.11): switch to typed emit via `createModuleEvents` for `ai_assistant`.
    await bus.emitEvent(eventId, payload, { persistent: true })
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
 *   `ai.action.expired` event is emitted (raw literal id; Step 5.11 will
 *   migrate to `createModuleEvents`). Returns `{ status: 'expired' }` so
 *   the route can translate to a 409 `expired` envelope.
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
  const eventBus = input.eventBus === undefined ? resolveEventBus(ctx.container) : input.eventBus

  if (action.status === 'cancelled') {
    return { row: action, status: 'cancelled' }
  }

  const expiresAt =
    action.expiresAt instanceof Date ? action.expiresAt : new Date(action.expiresAt)
  if (expiresAt.getTime() <= clock.getTime()) {
    const expiredRow = await repo.setStatus(action.id, 'expired', scope, { now: clock })
    await emitEventSafe(eventBus, EXPIRED_EVENT_ID, {
      pendingActionId: expiredRow.id,
      agentId: expiredRow.agentId,
      toolName: expiredRow.toolName,
      status: expiredRow.status,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? null,
      userId: ctx.userId,
      resolvedByUserId: null,
      resolvedAt: (expiredRow.resolvedAt ?? clock).toISOString?.() ?? new Date(clock).toISOString(),
    })
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
  await emitEventSafe(eventBus, CANCELLED_EVENT_ID, {
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
  })

  return { row: cancelledRow, status: 'cancelled' }
}

export const PENDING_ACTION_CANCELLED_EVENT_ID = CANCELLED_EVENT_ID
export const PENDING_ACTION_EXPIRED_EVENT_ID = EXPIRED_EVENT_ID
