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
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('cart')

const PAGE_SIZE = 50

const CART_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  active: 'info',
  locked: 'warning',
  converted: 'success',
  abandoned: 'neutral',
  expired: 'neutral',
  merged: 'neutral',
}

type CartAdminRow = {
  id: string
  status: string
  channel: string
  storeId: string | null
  customerId: string | null
  customerName: string | null
  customerUserId: string | null
  email: string | null
  currencyCode: string
  grandTotalGrossAmount: number | null
  requiresApproval: boolean
  // Non-null while a request is awaiting a decision; cleared to null by
  // `lib/approvalDecidedSubscriber.ts` on every terminal outcome (approved/rejected/
  // expired/withdrawn). `requiresApproval` alone never clears (§9a.4/§9a.5 — it is "this
  // basket crossed the threshold," not "still pending"), so it cannot distinguish a
  // resolved approval from a pending one on its own.
  awaitingApprovalSince: string | null
  lineCount: number
  lastActivityAt: string | null
  expiresAt: string | null
  updatedAt: string | null
}

type CartAdminListResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function readString(item: Record<string, unknown>, camel: string, snake: string): string | null {
  const camelValue = item[camel]
  if (typeof camelValue === 'string') return camelValue
  const snakeValue = item[snake]
  return typeof snakeValue === 'string' ? snakeValue : null
}

function readNumber(item: Record<string, unknown>, camel: string, snake: string): number | null {
  const value = item[camel] ?? item[snake]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function mapApiCart(item: Record<string, unknown>): CartAdminRow {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    status: typeof item.status === 'string' ? item.status : 'active',
    channel: typeof item.channel === 'string' ? item.channel : 'storefront',
    storeId: readString(item, 'storeId', 'store_id'),
    customerId: readString(item, 'customerId', 'customer_id'),
    customerName: readString(item, 'customerName', 'customer_name'),
    customerUserId: readString(item, 'customerUserId', 'customer_user_id'),
    email: readString(item, 'email', 'email'),
    currencyCode: readString(item, 'currencyCode', 'currency_code') ?? '',
    grandTotalGrossAmount: readNumber(item, 'grandTotalGrossAmount', 'grand_total_gross_amount'),
    requiresApproval: item.requiresApproval === true || item.requires_approval === true,
    awaitingApprovalSince: readString(item, 'awaitingApprovalSince', 'awaiting_approval_since'),
    lineCount: typeof item.lineCount === 'number' ? item.lineCount : 0,
    lastActivityAt: readString(item, 'lastActivityAt', 'last_activity_at'),
    expiresAt: readString(item, 'expiresAt', 'expires_at'),
    updatedAt: readString(item, 'updatedAt', 'updated_at'),
  }
}

export default function CartAdminListPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<CartAdminRow[]>([])
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
      title: t('cart.admin.list.pageTitle', 'Carts'),
      table: {
        status: t('cart.admin.list.table.status', 'Status'),
        channel: t('cart.admin.list.table.channel', 'Channel'),
        customer: t('cart.admin.list.table.customer', 'Customer'),
        total: t('cart.admin.list.table.total', 'Total'),
        lines: t('cart.admin.list.table.lines', 'Lines'),
        approval: t('cart.admin.list.table.approval', 'Approval'),
        lastActivity: t('cart.admin.list.table.lastActivity', 'Last activity'),
        expiresAt: t('cart.admin.list.table.expiresAt', 'Expires'),
        approvalResolved: t('cart.admin.list.table.approvalResolved', 'Approval resolved'),
        empty: t('cart.admin.list.table.empty', 'No carts match these filters.'),
      },
      filters: {
        status: t('cart.admin.list.filters.status', 'Status'),
        channel: t('cart.admin.list.filters.channel', 'Channel'),
        customerId: t('cart.admin.list.filters.customerId', 'Customer ID'),
        requiresApproval: t('cart.admin.list.filters.requiresApproval', 'Requires approval'),
        lastActivity: t('cart.admin.list.filters.lastActivity', 'Last activity between'),
      },
      statuses: {
        active: t('cart.admin.statuses.active', 'Active'),
        locked: t('cart.admin.statuses.locked', 'Locked'),
        converted: t('cart.admin.statuses.converted', 'Converted'),
        abandoned: t('cart.admin.statuses.abandoned', 'Abandoned'),
        expired: t('cart.admin.statuses.expired', 'Expired'),
        merged: t('cart.admin.statuses.merged', 'Merged'),
      },
      channels: {
        storefront: t('cart.admin.channels.storefront', 'Storefront'),
        pos: t('cart.admin.channels.pos', 'POS'),
        pay_link: t('cart.admin.channels.payLink', 'Pay link'),
        agent: t('cart.admin.channels.agent', 'Agent'),
        api: t('cart.admin.channels.api', 'API'),
      },
      actions: {
        refresh: t('cart.admin.list.actions.refresh', 'Refresh'),
        viewDetails: t('cart.admin.list.actions.viewDetails', 'View details'),
      },
      errors: {
        load: t('cart.admin.list.errors.load', 'Failed to load carts.'),
      },
    }),
    [t],
  )

  const loadCarts = React.useCallback(async () => {
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
      if (typeof filterValues.channel === 'string' && filterValues.channel) params.set('channel', filterValues.channel)
      if (typeof filterValues.customerId === 'string' && filterValues.customerId.trim()) {
        params.set('customerId', filterValues.customerId.trim())
      }
      if (filterValues.requiresApproval === true) params.set('requiresApproval', 'true')
      const lastActivity = filterValues.lastActivity
      if (lastActivity && typeof lastActivity === 'object') {
        if (lastActivity.from) params.set('lastActivityFrom', lastActivity.from)
        if (lastActivity.to) params.set('lastActivityTo', lastActivity.to)
      }

      const payload = await readApiResultOrThrow<CartAdminListResponse>(
        `/api/cart/carts?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0, totalPages: 1 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiCart))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(
        typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
      )
    } catch (error) {
      logger.error('cart.admin.list.load', { err: error })
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
      hasLoadedOnceRef.current = true
    }
  }, [page, sorting, filterValues, labels.errors.load])

  React.useEffect(() => {
    void loadCarts()
  }, [loadCarts, scopeVersion, reloadToken])

  const handleRefresh = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const filters = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'status',
        label: labels.filters.status,
        type: 'select',
        options: Object.entries(labels.statuses).map(([value, label]) => ({ value, label })),
      },
      {
        id: 'channel',
        label: labels.filters.channel,
        type: 'select',
        options: Object.entries(labels.channels).map(([value, label]) => ({ value, label })),
      },
      { id: 'customerId', label: labels.filters.customerId, type: 'text' },
      { id: 'requiresApproval', label: labels.filters.requiresApproval, type: 'checkbox' },
      { id: 'lastActivity', label: labels.filters.lastActivity, type: 'dateRange' },
    ],
    [labels],
  )

  const columns = React.useMemo<ColumnDef<CartAdminRow>[]>(
    () => [
      {
        accessorKey: 'status',
        header: labels.table.status,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <StatusBadge variant={CART_STATUS_VARIANTS[row.original.status] ?? 'neutral'} dot>
            {labels.statuses[row.original.status as keyof typeof labels.statuses] ?? row.original.status}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'channel',
        header: labels.table.channel,
        meta: { priority: 2 },
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            {labels.channels[row.original.channel as keyof typeof labels.channels] ?? row.original.channel}
          </span>
        ),
      },
      {
        accessorKey: 'customerId',
        id: 'customerId',
        header: labels.table.customer,
        enableSorting: false,
        meta: { priority: 2 },
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="truncate text-sm text-foreground">{row.original.customerName ?? row.original.email ?? '—'}</span>
            {row.original.customerName && row.original.email ? (
              <span className="truncate text-xs text-muted-foreground">{row.original.email}</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'grandTotalGrossAmount',
        id: 'grandTotalGrossAmount',
        header: () => <span className="block text-right">{labels.table.total}</span>,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-foreground">
            {formatCurrency(row.original.grandTotalGrossAmount, row.original.currencyCode) ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'lineCount',
        id: 'lineCount',
        header: () => <span className="block text-right">{labels.table.lines}</span>,
        enableSorting: false,
        meta: { priority: 3 },
        cell: ({ row }) => (
          <span className="block text-right text-sm tabular-nums text-foreground">{row.original.lineCount}</span>
        ),
      },
      {
        accessorKey: 'requiresApproval',
        id: 'requiresApproval',
        header: labels.table.approval,
        enableSorting: false,
        meta: { priority: 4 },
        cell: ({ row }) => {
          if (!row.original.requiresApproval) {
            return <span className="text-xs text-muted-foreground/70">—</span>
          }
          // `requiresApproval` alone never clears once set — `awaitingApprovalSince` is
          // what actually tracks "still pending a decision" (see the row type's comment).
          return row.original.awaitingApprovalSince ? (
            <StatusBadge variant="warning" dot>
              {labels.filters.requiresApproval}
            </StatusBadge>
          ) : (
            <StatusBadge variant="success" dot>
              {labels.table.approvalResolved}
            </StatusBadge>
          )
        },
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
      {
        accessorKey: 'expiresAt',
        header: labels.table.expiresAt,
        meta: { priority: 5 },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.expiresAt ? formatDateTime(row.original.expiresAt) ?? '—' : '—'}
          </span>
        ),
      },
    ],
    [labels],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<CartAdminRow>
          extensionTableId="cart.carts"
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
                {
                  id: 'view',
                  label: labels.actions.viewDetails,
                  href: `/backend/cart/carts/${row.id}`,
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/cart/carts/${row.id}`)}
        />
      </PageBody>
    </Page>
  )
}
