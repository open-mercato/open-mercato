import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

export const ACCESS_LOG_OUTCOME_VARIANTS = {
  ok: 'success',
  pending_approval: 'info',
  invalid_input: 'warning',
  denied: 'error',
  mutation_denied: 'error',
  error: 'error',
  dispatcher_unavailable: 'error',
} as const satisfies Record<string, StatusBadgeVariant>

export type AccessLogOutcome = keyof typeof ACCESS_LOG_OUTCOME_VARIANTS

export const ACCESS_LOG_CONTEXT_DETAIL_KEYS = [
  'principal',
  'channel',
  'mcpServer',
  'apiKeyId',
  'sessionKeyId',
  'correlationId',
  'errorCode',
  'isMutation',
  'agentId',
  'agentRunId',
  'aiAgentRunId',
  'pendingActionIds',
  'argKeys',
] as const

export type AccessLogContextDetailKey = (typeof ACCESS_LOG_CONTEXT_DETAIL_KEYS)[number]

const MAX_DISPLAY_LENGTH = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readAccessLogOutcome(context: unknown): AccessLogOutcome | null {
  if (!isRecord(context)) return null
  const outcome = context.outcome
  if (typeof outcome !== 'string') return null
  return Object.prototype.hasOwnProperty.call(ACCESS_LOG_OUTCOME_VARIANTS, outcome) ? (outcome as AccessLogOutcome) : null
}

export function readAccessLogDurationMs(context: unknown): number | null {
  if (!isRecord(context)) return null
  const duration = context.durationMs
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null
  return Math.round(duration)
}

export function truncateForDisplay(value: string, maxLength: number = MAX_DISPLAY_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

export function formatContextValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') return truncateForDisplay(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const parts = value.map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : JSON.stringify(entry)))
    return truncateForDisplay(parts.join(', '))
  }
  try {
    return truncateForDisplay(JSON.stringify(value))
  } catch {
    return null
  }
}

export function collectAccessLogContextDetails(context: unknown): Array<{ key: AccessLogContextDetailKey; value: string }> {
  if (!isRecord(context)) return []
  const rows: Array<{ key: AccessLogContextDetailKey; value: string }> = []
  for (const key of ACCESS_LOG_CONTEXT_DETAIL_KEYS) {
    const value = formatContextValue(context[key])
    if (value !== null) rows.push({ key, value })
  }
  return rows
}
