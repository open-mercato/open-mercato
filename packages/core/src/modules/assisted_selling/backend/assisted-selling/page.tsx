"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { readApiResultOrThrow, withScopedApiRequestHeaders, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEventCoalesced } from '@open-mercato/ui/backend/injection/useAppEventCoalesced'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('assisted_selling')

const PAGE_SIZE = 50

const THREAD_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  open: 'info',
  closed: 'neutral',
}

type ThreadRow = {
  id: string
  storeId: string
  buyerCartId: string
  customerId: string | null
  customerName: string | null
  customerUserId: string | null
  status: string
  assignedActorId: string | null
  assignedActorName: string | null
  liveProposalCount: number
  lastActivityAt: string | null
  updatedAt: string | null
}

type ThreadListResponse = { items?: Array<Record<string, unknown>>; total?: number; page?: number; pageSize?: number }

function readString(item: Record<string, unknown>, key: string): string | null {
  const value = item[key]
  return typeof value === 'string' ? value : null
}

function mapApiThread(item: Record<string, unknown>): ThreadRow {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    storeId: readString(item, 'storeId') ?? '',
    buyerCartId: readString(item, 'buyerCartId') ?? '',
    customerId: readString(item, 'customerId'),
    customerName: readString(item, 'customerName'),
    customerUserId: readString(item, 'customerUserId'),
    status: typeof item.status === 'string' ? item.status : 'open',
    assignedActorId: readString(item, 'assignedActorId'),
    assignedActorName: readString(item, 'assignedActorName'),
    liveProposalCount: typeof item.liveProposalCount === 'number' ? item.liveProposalCount : 0,
    lastActivityAt: readString(item, 'lastActivityAt'),
    updatedAt: readString(item, 'updatedAt'),
  }
}

export default function AssistedSellingInboxPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<ThreadRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'lastActivityAt', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const hasLoadedOnceRef = React.useRef(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(
    () => ({
      title: t('assisted_selling.admin.inbox.pageTitle', 'Selling conversations'),
      table: {
        status: t('assisted_selling.admin.inbox.table.status', 'Status'),
        buyer: t('assisted_selling.admin.inbox.table.buyer', 'Buyer'),
        assignee: t('assisted_selling.admin.inbox.table.assignee', 'Assigned to'),
        liveProposals: t('assisted_selling.admin.inbox.table.liveProposals', 'Live proposals'),
        lastActivity: t('assisted_selling.admin.inbox.table.lastActivity', 'Last activity'),
        empty: t('assisted_selling.admin.inbox.table.empty', 'No selling conversations match these filters.'),
      },
      filters: {
        status: t('assisted_selling.admin.inbox.filters.status', 'Status'),
        storeId: t('assisted_selling.admin.inbox.filters.storeId', 'Store ID'),
        assignee: t('assisted_selling.admin.inbox.filters.assignee', 'Assigned to'),
        awaitingBuyer: t('assisted_selling.admin.inbox.filters.awaitingBuyer', 'Awaiting the buyer'),
      },
      statuses: {
        open: t('assisted_selling.admin.statuses.open', 'Open'),
        closed: t('assisted_selling.admin.statuses.closed', 'Closed'),
      },
      assignees: {
        me: t('assisted_selling.admin.inbox.assignees.me', 'Mine'),
        unassigned: t('assisted_selling.admin.inbox.assignees.unassigned', 'Unassigned'),
      },
      actions: {
        refresh: t('assisted_selling.admin.inbox.actions.refresh', 'Refresh'),
        open: t('assisted_selling.admin.inbox.actions.open', 'Open'),
        assignToMe: t('assisted_selling.admin.inbox.actions.assignToMe', 'Assign to me'),
      },
      errors: {
        load: t('assisted_selling.admin.inbox.errors.load', 'Failed to load selling conversations.'),
        assign: t('assisted_selling.admin.inbox.errors.assign', 'Failed to assign this conversation.'),
      },
      flash: { assigned: t('assisted_selling.admin.inbox.flash.assigned', 'Conversation assigned to you.') },
    }),
    [t],
  )

  const loadThreads = React.useCallback(async () => {
    if (hasLoadedOnceRef.current) setIsRefreshing(true)
    else setIsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (typeof filterValues.status === 'string' && filterValues.status) params.set('status', filterValues.status)
      if (typeof filterValues.storeId === 'string' && filterValues.storeId.trim()) params.set('storeId', filterValues.storeId.trim())
      if (typeof filterValues.assignee === 'string' && filterValues.assignee) params.set('assignedActorId', filterValues.assignee)
      if (filterValues.awaitingBuyer === true) params.set('hasLiveProposals', 'true')

      const payload = await readApiResultOrThrow<ThreadListResponse>(
        `/api/assisted_selling/threads?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiThread))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(Math.max(1, Math.ceil((typeof payload.total === 'number' ? payload.total : items.length) / PAGE_SIZE)))
    } catch (error) {
      logger.error('assisted_selling.admin.inbox.load', { err: error })
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
      hasLoadedOnceRef.current = true
    }
  }, [page, sorting, filterValues, labels.errors.load])

  React.useEffect(() => {
    void loadThreads()
  }, [loadThreads, scopeVersion, reloadToken])

  const handleRefresh = React.useCallback(() => setReloadToken((token) => token + 1), [])

  // §6.8/§7.1: "clientBroadcast: true on thread, participant, message and proposal events so
  // the rep console updates without polling." Coalesced so a burst of events (e.g. a proposal
  // publish, which fires both `.proposal.published` and `.message.posted`) reloads the inbox
  // once, not twice.
  useAppEventCoalesced('assisted_selling.*', handleRefresh, [handleRefresh])

  const assignMutationContextId = 'assisted-selling-inbox:assign'
  const { runMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string }>({
    contextId: assignMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleAssignToMe = React.useCallback(
    async (row: ThreadRow) => {
      try {
        await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
              apiCall(`/api/assisted_selling/threads/${row.id}/assign`, {
                method: 'POST',
                body: JSON.stringify({}),
              }),
            ),
          context: { formId: assignMutationContextId, resourceKind: 'assisted_selling.thread', resourceId: row.id },
          mutationPayload: {},
        })
        flash(labels.flash.assigned, 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t)) {
          setReloadToken((token) => token + 1)
          return
        }
        flash(labels.errors.assign, 'error')
      }
    },
    [labels.errors.assign, labels.flash.assigned, runMutation, t],
  )

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: labels.filters.status,
        type: 'select',
        options: Object.entries(labels.statuses).map(([value, label]) => ({ value, label })),
      },
      { id: 'storeId', label: labels.filters.storeId, type: 'text' },
      {
        id: 'assignee',
        label: labels.filters.assignee,
        type: 'select',
        options: [
          { value: 'me', label: labels.assignees.me },
          { value: 'unassigned', label: labels.assignees.unassigned },
        ],
      },
      { id: 'awaitingBuyer', label: labels.filters.awaitingBuyer, type: 'checkbox' },
    ],
    [labels],
  )

  const columns = React.useMemo<ColumnDef<ThreadRow>[]>(
    () => [
      {
        accessorKey: 'status',
        header: labels.table.status,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <StatusBadge variant={THREAD_STATUS_VARIANTS[row.original.status] ?? 'neutral'} dot>
            {labels.statuses[row.original.status as keyof typeof labels.statuses] ?? row.original.status}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'customerId',
        id: 'customerId',
        header: labels.table.buyer,
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <span className="truncate text-sm text-foreground">
            {row.original.customerName ?? row.original.customerId ?? row.original.customerUserId ?? t('assisted_selling.admin.inbox.buyer.guest', 'Guest')}
          </span>
        ),
      },
      {
        accessorKey: 'assignedActorId',
        id: 'assignedActorId',
        header: labels.table.assignee,
        enableSorting: false,
        meta: { priority: 3 },
        cell: ({ row }) => (
          <span className="truncate text-sm text-foreground">
            {row.original.assignedActorName ?? row.original.assignedActorId ?? labels.assignees.unassigned}
          </span>
        ),
      },
      {
        accessorKey: 'liveProposalCount',
        id: 'liveProposalCount',
        header: () => <span className="block text-right">{labels.table.liveProposals}</span>,
        meta: { priority: 2 },
        cell: ({ row }) =>
          row.original.liveProposalCount > 0 ? (
            <span className="block text-right">
              <StatusBadge variant="warning" dot>
                {row.original.liveProposalCount}
              </StatusBadge>
            </span>
          ) : (
            <span className="block text-right text-xs text-muted-foreground/70">0</span>
          ),
      },
      {
        accessorKey: 'lastActivityAt',
        header: labels.table.lastActivity,
        meta: { priority: 2 },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.lastActivityAt ? formatDateTime(row.original.lastActivityAt) ?? '—' : '—'}
          </span>
        ),
      },
    ],
    [labels, t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<ThreadRow>
          extensionTableId="assisted_selling.threads"
          title={labels.title}
          titleHeadingLevel={1}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          toolbar={
            <FilterBar
              filters={filters}
              values={filterValues}
              onApply={(values) => {
                setFilterValues(values)
                setPage(1)
              }}
              onClear={() => {
                setFilterValues({})
                setPage(1)
              }}
            />
          }
          emptyState={
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">{labels.table.empty}</p>
            </div>
          }
          refreshButton={{ label: labels.actions.refresh, onRefresh: handleRefresh, isRefreshing: isLoading || isRefreshing }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
          stickyActionsColumn
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'open', label: labels.actions.open, href: `/backend/assisted-selling/threads/${row.id}` },
                { id: 'assign-to-me', label: labels.actions.assignToMe, onSelect: () => void handleAssignToMe(row) },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/assisted-selling/threads/${row.id}`)}
        />
      </PageBody>
    </Page>
  )
}
