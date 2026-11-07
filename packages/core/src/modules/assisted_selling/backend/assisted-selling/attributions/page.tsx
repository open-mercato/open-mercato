"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FilterBar } from '@open-mercato/ui/backend/FilterBar'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterOverlay'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('assisted_selling')

const PAGE_SIZE = 50

const OUTCOME_VARIANTS: Record<string, StatusBadgeVariant> = {
  order: 'success',
  quote: 'info',
}

type AttributionRow = {
  id: string
  cartId: string
  cartLineId: string | null
  salesOrderId: string | null
  salesQuoteId: string | null
  actorType: string
  actorId: string | null
  threadId: string | null
  proposalId: string | null
  lineNetAmount: string
  lineGrossAmount: string
  currencyCode: string
  convertedAt: string | null
  orderNumber: string | null
  quoteNumber: string | null
  lineName: string | null
  actorName: string | null
}

type AttributionListResponse = { items?: Array<Record<string, unknown>>; total?: number }

function readString(item: Record<string, unknown>, key: string): string | null {
  const value = item[key]
  return typeof value === 'string' ? value : null
}

function mapApiAttribution(item: Record<string, unknown>): AttributionRow {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    cartId: readString(item, 'cartId') ?? '',
    cartLineId: readString(item, 'cartLineId'),
    salesOrderId: readString(item, 'salesOrderId'),
    salesQuoteId: readString(item, 'salesQuoteId'),
    actorType: typeof item.actorType === 'string' ? item.actorType : '',
    actorId: readString(item, 'actorId'),
    threadId: readString(item, 'threadId'),
    proposalId: readString(item, 'proposalId'),
    lineNetAmount: readString(item, 'lineNetAmount') ?? '0',
    lineGrossAmount: readString(item, 'lineGrossAmount') ?? '0',
    currencyCode: readString(item, 'currencyCode') ?? '',
    convertedAt: readString(item, 'convertedAt'),
    orderNumber: readString(item, 'orderNumber'),
    quoteNumber: readString(item, 'quoteNumber'),
    lineName: readString(item, 'lineName'),
    actorName: readString(item, 'actorName'),
  }
}

export default function AssistedSellingAttributionsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [rows, setRows] = React.useState<AttributionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const hasLoadedOnceRef = React.useRef(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(
    () => ({
      title: t('assisted_selling.admin.attributions.pageTitle', 'Sales attribution'),
      table: {
        convertedAt: t('assisted_selling.admin.attributions.table.convertedAt', 'Converted at'),
        outcome: t('assisted_selling.admin.attributions.table.outcome', 'Outcome'),
        actor: t('assisted_selling.admin.attributions.table.actor', 'Attributed to'),
        line: t('assisted_selling.admin.attributions.table.line', 'Cart line'),
        amount: t('assisted_selling.admin.attributions.table.amount', 'Net amount'),
        empty: t('assisted_selling.admin.attributions.table.empty', 'No attribution rows match these filters.'),
        documentLevel: t('assisted_selling.admin.attributions.table.documentLevel', 'Document-level (degraded)'),
      },
      filters: {
        salesOrderId: t('assisted_selling.admin.attributions.filters.salesOrderId', 'Order ID'),
        salesQuoteId: t('assisted_selling.admin.attributions.filters.salesQuoteId', 'Quote ID'),
        proposalId: t('assisted_selling.admin.attributions.filters.proposalId', 'Proposal ID'),
        convertedAt: t('assisted_selling.admin.attributions.filters.convertedAt', 'Converted'),
      },
      actions: { refresh: t('assisted_selling.admin.attributions.actions.refresh', 'Refresh') },
      errors: { load: t('assisted_selling.admin.attributions.errors.load', 'Failed to load sales attribution.') },
    }),
    [t],
  )

  const loadAttributions = React.useCallback(async () => {
    if (hasLoadedOnceRef.current) setIsRefreshing(true)
    else setIsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (typeof filterValues.salesOrderId === 'string' && filterValues.salesOrderId.trim()) {
        params.set('salesOrderId', filterValues.salesOrderId.trim())
      }
      if (typeof filterValues.salesQuoteId === 'string' && filterValues.salesQuoteId.trim()) {
        params.set('salesQuoteId', filterValues.salesQuoteId.trim())
      }
      if (typeof filterValues.proposalId === 'string' && filterValues.proposalId.trim()) {
        params.set('proposalId', filterValues.proposalId.trim())
      }
      const convertedAt = filterValues.convertedAt as { from?: string; to?: string } | undefined
      if (convertedAt?.from) params.set('convertedFrom', convertedAt.from)
      if (convertedAt?.to) params.set('convertedTo', convertedAt.to)

      const payload = await readApiResultOrThrow<AttributionListResponse>(
        `/api/assisted_selling/attributions?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load, fallback: { items: [], total: 0 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapApiAttribution))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(Math.max(1, Math.ceil((typeof payload.total === 'number' ? payload.total : items.length) / PAGE_SIZE)))
    } catch (error) {
      logger.error('assisted_selling.admin.attributions.load', { err: error })
      flash(labels.errors.load, 'error')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
      hasLoadedOnceRef.current = true
    }
  }, [page, filterValues, labels.errors.load])

  React.useEffect(() => {
    void loadAttributions()
  }, [loadAttributions, scopeVersion, reloadToken])

  const handleRefresh = React.useCallback(() => setReloadToken((token) => token + 1), [])

  const filters = React.useMemo<FilterDef[]>(
    () => [
      { id: 'salesOrderId', label: labels.filters.salesOrderId, type: 'text' },
      { id: 'salesQuoteId', label: labels.filters.salesQuoteId, type: 'text' },
      { id: 'proposalId', label: labels.filters.proposalId, type: 'text' },
      { id: 'convertedAt', label: labels.filters.convertedAt, type: 'dateRange' },
    ],
    [labels],
  )

  const columns = React.useMemo<ColumnDef<AttributionRow>[]>(
    () => [
      {
        accessorKey: 'convertedAt',
        header: labels.table.convertedAt,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.convertedAt ? formatDateTime(row.original.convertedAt) ?? '—' : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'salesOrderId',
        id: 'outcome',
        header: labels.table.outcome,
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) => {
          const kind = row.original.salesOrderId ? 'order' : 'quote'
          const id = row.original.orderNumber ?? row.original.quoteNumber ?? row.original.salesOrderId ?? row.original.salesQuoteId ?? '—'
          return (
            <span className="flex items-center gap-2">
              <StatusBadge variant={OUTCOME_VARIANTS[kind] ?? 'neutral'} dot>
                {kind}
              </StatusBadge>
              <span className="truncate font-mono text-xs text-muted-foreground">{id}</span>
            </span>
          )
        },
      },
      {
        accessorKey: 'actorType',
        id: 'actor',
        header: labels.table.actor,
        enableSorting: false,
        meta: { priority: 2 },
        cell: ({ row }) => (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {row.original.actorName ?? row.original.actorType}
            {row.original.actorName || !row.original.actorId ? '' : `:${row.original.actorId}`}
          </span>
        ),
      },
      {
        accessorKey: 'cartLineId',
        id: 'line',
        header: labels.table.line,
        enableSorting: false,
        meta: { priority: 3 },
        cell: ({ row }) =>
          row.original.cartLineId ? (
            <span className="truncate font-mono text-xs text-muted-foreground">{row.original.lineName ?? row.original.cartLineId}</span>
          ) : (
            <StatusBadge variant="warning" dot>
              {labels.table.documentLevel}
            </StatusBadge>
          ),
      },
      {
        accessorKey: 'lineNetAmount',
        id: 'amount',
        header: () => <span className="block text-right">{labels.table.amount}</span>,
        enableSorting: false,
        meta: { priority: 1 },
        cell: ({ row }) => (
          <span className="block text-right text-xs text-muted-foreground">
            {row.original.lineNetAmount} {row.original.currencyCode}
          </span>
        ),
      },
    ],
    [labels],
  )

  return (
    <Page>
      <PageBody>
        <DataTable<AttributionRow>
          extensionTableId="assisted_selling.attributions"
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
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
