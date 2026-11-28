'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  AGENT_RUNS_API_PATH,
  AGENT_RUN_CHANNEL_OPTIONS,
  AGENT_RUN_STATUS_OPTIONS,
  agentRunChannelLabel,
  agentRunDetailHref,
  agentRunStatusLabel,
  agentRunStatusVariant,
  formatRunCount,
  formatRunDateTime,
  formatRunDuration,
  type AgentRunListItem,
  type AgentRunListResponse,
} from '../../../../components/agent-runs/agentRunsShared'

export const AGENT_RUNS_PAGE_SIZE = 50

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type AgentRunsFilters = {
  agentId?: string
  channel?: string
  status?: string
  startedFrom?: string
  startedTo?: string
}

function localDayBoundary(day: string, edge: 'start' | 'end'): string | null {
  const time = edge === 'start' ? '00:00:00.000' : '23:59:59.999'
  const date = new Date(`${day}T${time}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function buildAgentRunsQuery(page: number, filters: AgentRunsFilters): string {
  const search = new URLSearchParams()
  search.set('page', String(page))
  search.set('pageSize', String(AGENT_RUNS_PAGE_SIZE))
  if (filters.agentId) search.set('agentId', filters.agentId)
  if (filters.channel) search.set('channel', filters.channel)
  if (filters.status) search.set('status', filters.status)
  const from = filters.startedFrom ? localDayBoundary(filters.startedFrom, 'start') : null
  const to = filters.startedTo ? localDayBoundary(filters.startedTo, 'end') : null
  if (from) search.set('from', from)
  if (to) search.set('to', to)
  return search.toString()
}

function readFilterString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readDay(value: unknown): string | undefined {
  const day = readFilterString(value)
  return day && DATE_ONLY_PATTERN.test(day) ? day : undefined
}

export function normalizeAgentRunsFilters(values: FilterValues): AgentRunsFilters {
  const normalized: AgentRunsFilters = {}
  const agentId = readFilterString(values.agentId)
  const channel = readFilterString(values.channel)
  const status = readFilterString(values.status)
  if (agentId) normalized.agentId = agentId
  if (channel) normalized.channel = channel
  if (status) normalized.status = status
  const range: unknown = values.startedAt
  if (range && typeof range === 'object') {
    const { from, to } = range as { from?: unknown; to?: unknown }
    const startedFrom = readDay(from)
    const startedTo = readDay(to)
    if (startedFrom) normalized.startedFrom = startedFrom
    if (startedTo) normalized.startedTo = startedTo
  }
  return normalized
}

function toFilterValues(filters: AgentRunsFilters): FilterValues {
  const values: FilterValues = {}
  if (filters.agentId) values.agentId = filters.agentId
  if (filters.channel) values.channel = filters.channel
  if (filters.status) values.status = filters.status
  if (filters.startedFrom || filters.startedTo) {
    values.startedAt = { from: filters.startedFrom ?? null, to: filters.startedTo ?? null }
  }
  return values
}

async function fetchAgentRuns(page: number, filters: AgentRunsFilters): Promise<AgentRunListResponse> {
  const { result } = await apiCallOrThrow<AgentRunListResponse>(
    `${AGENT_RUNS_API_PATH}?${buildAgentRunsQuery(page, filters)}`,
    undefined,
    { errorMessage: '[internal] Failed to load agent runs' },
  )
  return result ?? { items: [], total: 0, page, pageSize: AGENT_RUNS_PAGE_SIZE, totalPages: 0 }
}

export function AiRunsListPageClient() {
  const t = useT()
  const router = useRouter()
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<AgentRunsFilters>({})

  const query = useQuery<AgentRunListResponse>({
    queryKey: ['ai_assistant', 'agent_runs', page, filters],
    queryFn: () => fetchAgentRuns(page, filters),
    retry: false,
  })

  const items = React.useMemo(() => query.data?.items ?? [], [query.data])

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'agentId',
        label: t('ai_assistant.runs.filters.agent', 'Agent'),
        type: 'text',
        placeholder: t('ai_assistant.runs.filters.agentPlaceholder', 'Agent id, e.g. catalog.merchandiser'),
      },
      {
        id: 'channel',
        label: t('ai_assistant.runs.filters.channel', 'Channel'),
        type: 'select',
        options: AGENT_RUN_CHANNEL_OPTIONS.map((channel) => ({
          value: channel,
          label: agentRunChannelLabel(t, channel),
        })),
      },
      {
        id: 'status',
        label: t('ai_assistant.runs.filters.status', 'Status'),
        type: 'select',
        options: AGENT_RUN_STATUS_OPTIONS.map((status) => ({
          value: status,
          label: agentRunStatusLabel(t, status),
        })),
      },
      {
        id: 'startedAt',
        label: t('ai_assistant.runs.filters.startedAt', 'Started between'),
        type: 'dateRange',
      },
    ],
    [t],
  )

  const filterValues = React.useMemo<FilterValues>(() => toFilterValues(filters), [filters])

  const applyFilters = React.useCallback((values: FilterValues) => {
    setPage(1)
    setFilters(normalizeAgentRunsFilters(values))
  }, [])

  const clearFilters = React.useCallback(() => {
    setPage(1)
    setFilters({})
  }, [])

  const columns = React.useMemo<ColumnDef<AgentRunListItem, unknown>[]>(
    () => [
      {
        accessorKey: 'agentId',
        header: t('ai_assistant.runs.columns.agent', 'Agent'),
        cell: ({ row }) => (
          <Link
            href={agentRunDetailHref(row.original.id)}
            className="font-mono text-xs text-foreground hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.agentId}
          </Link>
        ),
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        accessorKey: 'status',
        header: t('ai_assistant.runs.columns.status', 'Status'),
        cell: ({ row }) => (
          <StatusBadge variant={agentRunStatusVariant(row.original.status)} dot>
            {agentRunStatusLabel(t, row.original.status)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'channel',
        header: t('ai_assistant.runs.columns.channel', 'Channel'),
        cell: ({ row }) => agentRunChannelLabel(t, row.original.channel),
      },
      {
        accessorKey: 'modelId',
        header: t('ai_assistant.runs.columns.model', 'Model'),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.modelId}</span>,
        meta: { truncate: true, maxWidth: 200 },
      },
      {
        id: 'tokens',
        header: t('ai_assistant.runs.columns.tokens', 'Tokens'),
        cell: ({ row }) =>
          t('ai_assistant.runs.tokensValue', '{input} in / {output} out', {
            input: formatRunCount(row.original.inputTokens),
            output: formatRunCount(row.original.outputTokens),
          }),
      },
      {
        accessorKey: 'toolCallCount',
        header: t('ai_assistant.runs.columns.toolCalls', 'Tool calls'),
        cell: ({ row }) => formatRunCount(row.original.toolCallCount),
      },
      {
        accessorKey: 'durationMs',
        header: t('ai_assistant.runs.columns.duration', 'Duration'),
        cell: ({ row }) => formatRunDuration(row.original.durationMs),
      },
      {
        accessorKey: 'startedAt',
        header: t('ai_assistant.runs.columns.startedAt', 'Started'),
        cell: ({ row }) => formatRunDateTime(row.original.startedAt),
      },
    ],
    [t],
  )

  const total = query.data?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">{t('ai_assistant.runs.list.title', 'Agent runs')}</h2>
        <p className="text-xs text-muted-foreground">
          {t(
            'ai_assistant.runs.list.subtitle',
            'Every AI agent turn with its model, tokens, steps and tool calls. Open a run to inspect its trace.',
          )}
        </p>
      </div>

      <DataTable<AgentRunListItem>
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        error={query.error ? t('ai_assistant.runs.list.loadError', 'Failed to load agent runs.') : undefined}
        filters={filterDefs}
        filterValues={filterValues}
        onFiltersApply={applyFilters}
        onFiltersClear={clearFilters}
        onRowClick={(row) => router.push(agentRunDetailHref(row.id))}
        emptyState={
          <EmptyState
            title={t('ai_assistant.runs.list.empty', 'No agent runs yet.')}
            description={t(
              'ai_assistant.runs.list.emptyDescription',
              'Runs appear here after an AI agent answers in chat, the playground or over MCP.',
            )}
          />
        }
        pagination={{
          page,
          pageSize: AGENT_RUNS_PAGE_SIZE,
          total,
          totalPages: Math.max(1, Math.ceil(total / AGENT_RUNS_PAGE_SIZE)),
          onPageChange: setPage,
        }}
      />
    </div>
  )
}

export default AiRunsListPageClient
