/**
 * Shared enums + error type for the Phase 3 WS-C mutation approval gate
 * (spec §8 `AiPendingAction` + §9 server contract).
 *
 * These values are referenced by the entity, the repository, the
 * `/api/ai/actions/*` routes (Steps 5.7 / 5.8 / 5.9), and the cleanup
 * worker (Step 5.12). Colocated here so every consumer shares the same
 * source of truth.
 */

export const AI_PENDING_ACTION_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'expired',
  'executing',
  'failed',
] as const

export type AiPendingActionStatus = (typeof AI_PENDING_ACTION_STATUSES)[number]

export const AI_PENDING_ACTION_QUEUE_MODES = ['inline', 'stack'] as const

export type AiPendingActionQueueMode = (typeof AI_PENDING_ACTION_QUEUE_MODES)[number]

/**
 * Allowed state-machine edges for `AiPendingAction.status`:
 *
 * ```
 *     pending ──┬─▶ confirmed ──▶ executing ──▶ failed
 *               │                        └──▶ (terminal success keeps status = 'confirmed'
 *               │                               and stores executionResult.recordId)
 *               ├─▶ cancelled
 *               └─▶ expired
 * ```
 *
 * Every other transition is rejected with `AiPendingActionStateError`.
 */
export const AI_PENDING_ACTION_ALLOWED_TRANSITIONS: Record<
  AiPendingActionStatus,
  ReadonlyArray<AiPendingActionStatus>
> = {
  pending: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['executing'],
  executing: ['confirmed', 'failed'],
  cancelled: [],
  expired: [],
  failed: [],
}

export const AI_PENDING_ACTION_TERMINAL_STATUSES: ReadonlyArray<AiPendingActionStatus> = [
  'confirmed',
  'cancelled',
  'expired',
  'failed',
]

/**
 * Per-record batch diff entry, mirrored in `AiPendingAction.records`.
 *
 * When present, the batch diff is authoritative and `fieldDiff` at the
 * top level is ignored by every consumer (spec §8 rule 2).
 */
export type AiPendingActionRecordDiff = {
  recordId: string
  entityType: string
  label: string
  fieldDiff: Array<{ field: string; before: unknown; after: unknown }>
  recordVersion: string | null
  attachmentIds?: string[]
}

/**
 * Per-record failure shape populated by the confirm handler (Step 5.8)
 * when partial success occurs inside a batch.
 */
export type AiPendingActionFailedRecord = {
  recordId: string
  error: { code: string; message: string }
}

export type AiPendingActionFieldDiff = {
  field: string
  before: unknown
  after: unknown
}

export type AiPendingActionExecutionResult = {
  recordId?: string
  commandName?: string
  error?: { code: string; message: string }
}

/**
 * Thrown by the repository when a caller attempts an illegal status
 * transition (e.g. `confirmed → pending`). Callers at the route layer
 * turn this into a `409 Conflict` response.
 */
export class AiPendingActionStateError extends Error {
  public readonly code = 'ai_pending_action_invalid_transition'

  constructor(
    public readonly from: AiPendingActionStatus,
    public readonly to: AiPendingActionStatus,
  ) {
    super(`Illegal AiPendingAction status transition: ${from} → ${to}`)
    this.name = 'AiPendingActionStateError'
  }
}

export function isAiPendingActionStatus(
  value: unknown,
): value is AiPendingActionStatus {
  return (
    typeof value === 'string' &&
    (AI_PENDING_ACTION_STATUSES as readonly string[]).includes(value)
  )
}

export function isAiPendingActionQueueMode(
  value: unknown,
): value is AiPendingActionQueueMode {
  return (
    typeof value === 'string' &&
    (AI_PENDING_ACTION_QUEUE_MODES as readonly string[]).includes(value)
  )
}

export function isTerminalAiPendingActionStatus(
  status: AiPendingActionStatus,
): boolean {
  return AI_PENDING_ACTION_TERMINAL_STATUSES.includes(status)
}

export function isAllowedAiPendingActionTransition(
  from: AiPendingActionStatus,
  to: AiPendingActionStatus,
): boolean {
  return (AI_PENDING_ACTION_ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Default TTL for a pending action (spec §8 rule `expiresAt defaults to 10 min;
 * overridable per agent`). The runtime default is 15 min here because the
 * Step 5.5 brief pins it there; the repo reads `AI_PENDING_ACTION_TTL_SECONDS`
 * from the environment to allow override without a code change.
 */
export const AI_PENDING_ACTION_DEFAULT_TTL_SECONDS = 900
export const AI_PENDING_ACTION_TTL_ENV_VAR = 'AI_PENDING_ACTION_TTL_SECONDS'

export function resolveAiPendingActionTtlSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[AI_PENDING_ACTION_TTL_ENV_VAR]
  if (raw == null) return AI_PENDING_ACTION_DEFAULT_TTL_SECONDS
  const parsed = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return AI_PENDING_ACTION_DEFAULT_TTL_SECONDS
  }
  return parsed
}
