import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { SerializedPendingActionWithRequester } from '../../lib/pending-action-client'
import type {
  AiPendingActionChannel,
  AiPendingActionStatus,
} from '../../lib/pending-action-types'

export type PendingActionItem = SerializedPendingActionWithRequester

export type PendingActionListResponse = {
  items: PendingActionItem[]
  total: number
  page: number
  pageSize: number
}

export const PENDING_ACTIONS_HREF = '/backend/config/ai-assistant/pending-actions'
export const PENDING_ACTIONS_API_PATH = '/api/ai_assistant/ai/actions'

export const PENDING_ACTION_STATUS_OPTIONS: ReadonlyArray<AiPendingActionStatus> = [
  'pending',
  'confirmed',
  'cancelled',
  'expired',
  'executing',
  'failed',
]

export const PENDING_ACTION_CHANNEL_OPTIONS: ReadonlyArray<AiPendingActionChannel> = [
  'agent',
  'mcp',
  'tools-api',
]

export const OPTIONAL_REQUEST_HEADERS: Record<string, string> = {
  'x-om-forbidden-redirect': '0',
}

const STATUS_VARIANTS: Record<AiPendingActionStatus, StatusBadgeVariant> = {
  pending: 'warning',
  confirmed: 'success',
  cancelled: 'neutral',
  expired: 'neutral',
  executing: 'info',
  failed: 'error',
}

const STATUS_FALLBACKS: Record<AiPendingActionStatus, string> = {
  pending: 'Pending',
  confirmed: 'Approved',
  cancelled: 'Rejected',
  expired: 'Expired',
  executing: 'Executing',
  failed: 'Failed',
}

const CHANNEL_FALLBACKS: Record<AiPendingActionChannel, string> = {
  agent: 'Chat',
  mcp: 'MCP',
  'tools-api': 'Tools API',
}

const ERROR_FALLBACKS: Record<string, string> = {
  stale_version: 'The record changed after this action was proposed. Ask for a fresh proposal.',
  schema_drift: 'The tool no longer accepts the stored input. Ask for a fresh proposal.',
  tool_not_exposed: 'This tool is no longer exposed, so the action cannot run.',
  tool_not_whitelisted: 'The agent is no longer allowed to use this tool.',
  requester_revoked: 'The API key or session that requested this action was revoked.',
  requester_features_denied: 'The requester no longer has permission to run this tool.',
  approver_features_denied: 'You do not have the permissions this tool requires.',
  agent_features_denied: 'You do not have the permissions this agent requires.',
  agent_unknown: 'The agent that proposed this action is no longer available.',
  read_only_agent: 'The agent is read-only, so the action cannot run.',
  attachment_cross_tenant: 'An attachment of this action is outside your tenant.',
  expired: 'This action expired before it was decided.',
  invalid_status: 'This action was already decided.',
  pending_action_not_found: 'This action no longer exists or you cannot access it.',
  forbidden: 'You do not have permission to decide this action.',
  validation_error: 'The request was rejected as invalid.',
  execution_failed: 'The action was approved but failed while running.',
}

export function pendingActionStatusVariant(status: AiPendingActionStatus): StatusBadgeVariant {
  return STATUS_VARIANTS[status] ?? 'neutral'
}

export function pendingActionStatusLabel(t: TranslateFn, status: AiPendingActionStatus): string {
  return t(`ai_assistant.pendingActions.status.${status}`, STATUS_FALLBACKS[status] ?? status)
}

export function pendingActionChannelLabel(t: TranslateFn, channel: AiPendingActionChannel): string {
  return t(`ai_assistant.pendingActions.channel.${channel}`, CHANNEL_FALLBACKS[channel] ?? channel)
}

export function pendingActionErrorMessage(t: TranslateFn, code: string | null | undefined): string {
  if (code && Object.prototype.hasOwnProperty.call(ERROR_FALLBACKS, code)) {
    return t(`ai_assistant.pendingActions.errors.${code}`, ERROR_FALLBACKS[code])
  }
  return t('ai_assistant.pendingActions.errors.generic', 'The action could not be completed. Try again.')
}

export function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

export function pendingActionDetailHref(id: string): string {
  return `${PENDING_ACTIONS_HREF}/${encodeURIComponent(id)}`
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
