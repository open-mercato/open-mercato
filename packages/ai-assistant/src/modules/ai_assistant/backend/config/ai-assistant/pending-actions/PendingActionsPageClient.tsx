'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import {
  PENDING_ACTIONS_API_PATH,
  PENDING_ACTION_CHANNEL_OPTIONS,
  PENDING_ACTION_STATUS_OPTIONS,
  formatDateTime,
  pendingActionChannelLabel,
  pendingActionDetailHref,
  pendingActionStatusLabel,
  pendingActionStatusVariant,
  type PendingActionItem,
  type PendingActionListResponse,
} from '../../../../components/pending-actions/pendingActionsShared'
import { RequesterLabel } from '../../../../components/pending-actions/RequesterLabel'
import { useRequesterLabels } from '../../../../components/pending-actions/useRequesterLabels'

export const PENDING_ACTIONS_PAGE_SIZE = 50

export type PendingActionsFilters = {
  status?: string
  channel?: string
  mine?: boolean
}

export function buildPendingActionsQuery(page: number, filters: PendingActionsFilters): string {
  const search = new URLSearchParams()
  search.set('page', String(page))
  search.set('pageSize', String(PENDING_ACTIONS_PAGE_SIZE))
  if (filters.status) search.set('status', filters.status)
  if (filters.channel) search.set('channel', filters.channel)
  if (filters.mine) search.set('mine', 'true')
  return search.toString()
}

function readFilterString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readFilterBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return parseBooleanToken(value) === true
  return false
}

export function normalizePendingActionsFilters(values: FilterValues): PendingActionsFilters {
  const normalized: PendingActionsFilters = {}
  const status = readFilterString(values.status)
  const channel = readFilterString(values.channel)
  if (status) normalized.status = status
  if (channel) normalized.channel = channel
  if (readFilterBoolean(values.mine)) normalized.mine = true
  return normalized
}

async function fetchPendingActions(
  page: number,
  filters: PendingActionsFilters,
): Promise<PendingActionListResponse> {
  const { result } = await apiCallOrThrow<PendingActionListResponse>(
    `${PENDING_ACTIONS_API_PATH}?${buildPendingActionsQuery(page, filters)}`,
    undefined,
    { errorMessage: '[internal] Failed to load pending AI actions' },
  )
  return result ?? { items: [], total: 0, page, pageSize: PENDING_ACTIONS_PAGE_SIZE }
}

export function PendingActionsPageClient() {
  const t = useT()
  const router = useRouter()
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<PendingActionsFilters>({ status: 'pending' })

  const query = useQuery<PendingActionListResponse>({
    queryKey: ['ai_assistant', 'pending_actions', page, filters],
    queryFn: () => fetchPendingActions(page, filters),
    retry: false,
  })

  const items = React.useMemo(() => query.data?.items ?? [], [query.data])
  const requesterIds = React.useMemo(() => items.map((item) => item.requester.userId), [items])
  const requesterLabels = useRequesterLabels(requesterIds)

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: t('ai_assistant.pendingActions.filters.status', 'Status'),
        type: 'select',
        options: PENDING_ACTION_STATUS_OPTIONS.map((status) => ({
          value: status,
          label: pendingActionStatusLabel(t, status),
        })),
      },
      {
        id: 'channel',
        label: t('ai_assistant.pendingActions.filters.channel', 'Channel'),
        type: 'select',
        options: PENDING_ACTION_CHANNEL_OPTIONS.map((channel) => ({
          value: channel,
          label: pendingActionChannelLabel(t, channel),
        })),
      },
      {
        id: 'mine',
        label: t('ai_assistant.pendingActions.filters.mine', 'Only my requests'),
        type: 'checkbox',
      },
    ],
    [t],
  )

  const filterValues = React.useMemo<FilterValues>(() => ({ ...filters }), [filters])

  const applyFilters = React.useCallback((values: FilterValues) => {
    setPage(1)
    setFilters(normalizePendingActionsFilters(values))
  }, [])

  const clearFilters = React.useCallback(() => {
    setPage(1)
    setFilters({})
  }, [])

  const columns = React.useMemo<ColumnDef<PendingActionItem, unknown>[]>(
    () => [
      {
        accessorKey: 'toolName',
        header: t('ai_assistant.pendingActions.columns.tool', 'Tool'),
        cell: ({ row }) => (
          <Link
            href={pendingActionDetailHref(row.original.id)}
            className="font-mono text-xs text-foreground hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.toolName}
          </Link>
        ),
      },
      {
        id: 'target',
        header: t('ai_assistant.pendingActions.columns.target', 'Target'),
        cell: ({ row }) => {
          const { targetEntityType, targetRecordId } = row.original
          if (!targetEntityType && !targetRecordId) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span>{targetEntityType ?? '—'}</span>
              {targetRecordId ? (
                <span className="font-mono text-xs text-muted-foreground">{targetRecordId}</span>
              ) : null}
            </div>
          )
        },
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        id: 'requester',
        header: t('ai_assistant.pendingActions.columns.requester', 'Requester'),
        cell: ({ row }) => (
          <RequesterLabel requester={row.original.requester} labels={requesterLabels} />
        ),
      },
      {
        accessorKey: 'channel',
        header: t('ai_assistant.pendingActions.columns.channel', 'Channel'),
        cell: ({ row }) => pendingActionChannelLabel(t, row.original.channel),
      },
      {
        accessorKey: 'createdAt',
        header: t('ai_assistant.pendingActions.columns.createdAt', 'Created'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'expiresAt',
        header: t('ai_assistant.pendingActions.columns.expiresAt', 'Expires'),
        cell: ({ row }) => formatDateTime(row.original.expiresAt),
      },
      {
        accessorKey: 'status',
        header: t('ai_assistant.pendingActions.columns.status', 'Status'),
        cell: ({ row }) => (
          <StatusBadge variant={pendingActionStatusVariant(row.original.status)} dot>
            {pendingActionStatusLabel(t, row.original.status)}
          </StatusBadge>
        ),
      },
    ],
    [requesterLabels, t],
  )

  const total = query.data?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">
          {t('ai_assistant.pendingActions.title', 'Pending AI actions')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t(
            'ai_assistant.pendingActions.subtitle',
            'Writes requested by AI tools that wait for a human decision. Open an action to review the change and approve or reject it.',
          )}
        </p>
      </div>

      <DataTable<PendingActionItem>
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        error={
          query.error
            ? t('ai_assistant.pendingActions.loadError', 'Failed to load pending AI actions.')
            : undefined
        }
        filters={filterDefs}
        filterValues={filterValues}
        onFiltersApply={applyFilters}
        onFiltersClear={clearFilters}
        onRowClick={(row) => router.push(pendingActionDetailHref(row.id))}
        emptyState={
          <EmptyState
            title={t('ai_assistant.pendingActions.empty.title', 'No AI actions to show')}
            description={t(
              'ai_assistant.pendingActions.empty.description',
              'AI actions that need approval appear here when a tool requests a write.',
            )}
          />
        }
        pagination={{
          page,
          pageSize: PENDING_ACTIONS_PAGE_SIZE,
          total,
          totalPages: Math.max(1, Math.ceil(total / PENDING_ACTIONS_PAGE_SIZE)),
          onPageChange: setPage,
        }}
      />
    </div>
  )
}

export default PendingActionsPageClient
