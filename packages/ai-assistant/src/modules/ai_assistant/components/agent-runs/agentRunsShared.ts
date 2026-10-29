import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import {
  AI_AGENT_RUN_CHANNELS,
  AI_AGENT_RUN_STATUSES,
} from '../../data/validators'
import type {
  AiAgentRunListItem,
  AiAgentRunPage,
  serializeAgentRunDetail,
  serializeAgentRunStep,
  serializeAgentRunToolCall,
} from '../../lib/agent-run-access'

export type AgentRunChannel = (typeof AI_AGENT_RUN_CHANNELS)[number]

export type AgentRunStatus = (typeof AI_AGENT_RUN_STATUSES)[number]

export type AgentRunListItem = AiAgentRunListItem

export type AgentRunListResponse = AiAgentRunPage

export type AgentRunDetail = ReturnType<typeof serializeAgentRunDetail>

export type AgentRunStep = ReturnType<typeof serializeAgentRunStep>

export type AgentRunToolCall = ReturnType<typeof serializeAgentRunToolCall>

export type AgentRunDetailResponse = {
  run: AgentRunDetail
  steps: AgentRunStep[]
  toolCalls: AgentRunToolCall[]
  links: { conversationId: string | null; pendingActionIds: string[] }
}

export const AGENT_RUNS_HREF = '/backend/config/ai-assistant/runs'

export const AGENT_RUNS_API_PATH = '/api/ai_assistant/ai/runs'

export const AGENT_RUN_STATUS_OPTIONS: ReadonlyArray<AgentRunStatus> = AI_AGENT_RUN_STATUSES

export const AGENT_RUN_CHANNEL_OPTIONS: ReadonlyArray<AgentRunChannel> = AI_AGENT_RUN_CHANNELS

const STATUS_VARIANTS: Record<AgentRunStatus, StatusBadgeVariant> = {
  completed: 'success',
  failed: 'error',
  aborted: 'warning',
}

const STATUS_FALLBACKS: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  aborted: 'Aborted',
}

const CHANNEL_FALLBACKS: Record<AgentRunChannel, string> = {
  chat: 'Chat',
  playground: 'Playground',
  'run-object': 'Run object',
  mcp: 'MCP',
  'tools-api': 'Tools API',
  internal: 'Internal',
}

function isKnownStatus(status: string): status is AgentRunStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_FALLBACKS, status)
}

function isKnownChannel(channel: string): channel is AgentRunChannel {
  return Object.prototype.hasOwnProperty.call(CHANNEL_FALLBACKS, channel)
}

export function agentRunStatusVariant(status: string): StatusBadgeVariant {
  return isKnownStatus(status) ? STATUS_VARIANTS[status] : 'neutral'
}

export function agentRunStatusLabel(t: TranslateFn, status: string): string {
  return isKnownStatus(status) ? t(`ai_assistant.runs.status.${status}`, STATUS_FALLBACKS[status]) : status
}

export function agentRunChannelLabel(t: TranslateFn, channel: string): string {
  return isKnownChannel(channel) ? t(`ai_assistant.runs.channel.${channel}`, CHANNEL_FALLBACKS[channel]) : channel
}

export function agentRunDetailHref(id: string): string {
  return `${AGENT_RUNS_HREF}/${encodeURIComponent(id)}`
}

export function agentRunConversationHref(conversationId: string): string {
  return `/backend?openAiConversation=${encodeURIComponent(conversationId)}`
}

export function formatRunDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function formatRunDuration(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '—'
  if (durationMs < 1000) {
    return new Intl.NumberFormat(undefined, { style: 'unit', unit: 'millisecond', maximumFractionDigits: 0 }).format(durationMs)
  }
  return new Intl.NumberFormat(undefined, { style: 'unit', unit: 'second', maximumFractionDigits: 1 }).format(durationMs / 1000)
}

export function formatRunCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat().format(value)
}

export function shortHash(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 12 ? value.slice(0, 12) : value
}
