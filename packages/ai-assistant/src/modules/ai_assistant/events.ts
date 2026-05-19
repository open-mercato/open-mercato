import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * AI Assistant Module Events
 *
 * Typed declarations for the pending-action lifecycle events emitted by
 * the Phase 3 WS-C mutation approval flow. The event IDs are FROZEN per
 * `BACKWARD_COMPATIBILITY.md` §5 (contract surface #5) and MUST NOT be
 * renamed; additive payload changes are allowed.
 *
 * - `ai.action.confirmed` — emitted by `executePendingActionConfirm`
 *   (Step 5.8) after the `pending → confirmed → executing → {confirmed|
 *   failed}` transition. The handler's outcome lives in
 *   `executionResult`; partial-stale rows carry the surviving stale
 *   records via `failedRecords`.
 * - `ai.action.cancelled` — emitted by `executePendingActionCancel`
 *   (Step 5.9) after the atomic `pending → cancelled` transition.
 * - `ai.action.expired` — emitted by the Step 5.9 expired short-circuit
 *   AND by the Step 5.12 cleanup worker when the TTL elapses. The
 *   worker is the actor in that path, so `resolvedByUserId` is NOT part
 *   of the payload.
 */
const events = [
  {
    id: 'ai.action.confirmed',
    label: 'AI Pending Action Confirmed',
    entity: 'ai_pending_action',
    category: 'system' as const,
  },
  {
    id: 'ai.action.cancelled',
    label: 'AI Pending Action Cancelled',
    entity: 'ai_pending_action',
    category: 'system' as const,
  },
  {
    id: 'ai.action.expired',
    label: 'AI Pending Action Expired',
    entity: 'ai_pending_action',
    category: 'system' as const,
  },
  {
    id: 'ai.token_usage.recorded',
    label: 'AI Token Usage Recorded',
    entity: 'token_usage',
    category: 'system' as const,
    clientBroadcast: false,
    portalBroadcast: false,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'ai_assistant',
  events,
})

/** Type-safe event emitter for the ai_assistant module. */
export const emitAiAssistantEvent = eventsConfig.emit

/** Event IDs declared by the ai_assistant module. */
export type AiAssistantEventId = (typeof events)[number]['id']

/**
 * Typed payload contracts for each ai_assistant event. Payloads are
 * additive-only — extend existing fields rather than renaming/removing.
 */
export interface AiActionFailedRecordPayload {
  recordId: string
  error: { code: string; message: string }
}

export interface AiActionExecutionResultPayload {
  recordId?: string
  commandName?: string
  error?: { code: string; message: string }
}

export interface AiActionConfirmedPayload {
  pendingActionId: string
  agentId: string
  toolName: string
  status: string
  tenantId: string | null
  organizationId: string | null
  userId: string
  resolvedByUserId: string
  resolvedAt: string
  executionResult: AiActionExecutionResultPayload | null
  failedRecords?: AiActionFailedRecordPayload[] | null
}

export interface AiActionCancelledPayload {
  pendingActionId: string
  agentId: string
  toolName: string
  status: string
  tenantId: string | null
  organizationId: string | null
  userId: string
  resolvedByUserId: string
  resolvedAt: string
  executionResult: AiActionExecutionResultPayload | null
  reason?: string
}

export interface AiActionExpiredPayload {
  pendingActionId: string
  agentId: string
  toolName: string
  status: string
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  resolvedByUserId: null
  resolvedAt: string
  expiresAt?: string
  expiredAt?: string
}

export default eventsConfig
