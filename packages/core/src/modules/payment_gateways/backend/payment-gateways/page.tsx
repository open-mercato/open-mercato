"use client"
import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ChevronDown, ChevronRight, CreditCard, RefreshCw, Webhook } from 'lucide-react'

type TransactionRow = {
  id: string
  paymentId: string
  providerKey: string
  providerSessionId?: string | null
  gatewayPaymentId?: string | null
  gatewayRefundId?: string | null
  unifiedStatus: string
  gatewayStatus?: string | null
  amount: string
  currencyCode: string
  redirectUrl?: string | null
  lastWebhookAt?: string | null
  lastPolledAt?: string | null
  createdAt: string | null
  updatedAt: string | null
}

type TransactionLogEntry = {
  id: string
  integrationId: string
  runId?: string | null
  scopeEntityType?: string | null
  scopeEntityId?: string | null
  level: 'info' | 'warn' | 'error'
  message: string
  code?: string | null
  payload?: Record<string, unknown> | null
  createdAt: string | null
}

type TransactionDetail = {
  transaction: {
    id: string
    paymentId: string
    providerKey: string
    providerSessionId?: string | null
    gatewayPaymentId?: string | null
    gatewayRefundId?: string | null
    unifiedStatus: string
    gatewayStatus?: string | null
    redirectUrl?: string | null
    amount: string
    currencyCode: string
    gatewayMetadata?: Record<string, unknown> | null
    webhookLog?: Array<{
      eventType: string
      receivedAt: string
      idempotencyKey: string
      unifiedStatus: string
      processed: boolean
    }> | null
    lastWebhookAt?: string | null
    lastPolledAt?: string | null
    expiresAt?: string | null
    createdAt: string | null
    updatedAt: string | null
  }
  logs: TransactionLogEntry[]
}

type TransactionsResponse = {
  items: TransactionRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-800',
  authorized: 'bg-blue-100 text-blue-800',
  captured: 'bg-green-100 text-green-800',
  partially_captured: 'bg-emerald-100 text-emerald-800',
  refunded: 'bg-amber-100 text-amber-800',
  partially_refunded: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-zinc-200 text-zinc-900',
  failed: 'bg-red-100 text-red-800',
  expired: 'bg-neutral-200 text-neutral-900',
  unknown: 'bg-purple-100 text-purple-800',
}

const LOG_LEVEL_STYLES: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function formatAmount(value: string, currencyCode: string): string {
  const amount = Number(value)
  if (Number.isNaN(amount)) return `${value} ${currencyCode}`
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`
  }
}

function formatTypeLabel(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function formatLogDetailLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function isPrimitiveLogValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function splitLogPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return {
      inlineEntries: [] as Array<[string, string | number | boolean | null]>,
      nestedEntries: [] as Array<[string, unknown]>,
    }
  }

  const inlineEntries: Array<[string, string | number | boolean | null]> = []
  const nestedEntries: Array<[string, unknown]> = []
  Object.entries(payload).forEach(([key, value]) => {
    if (isPrimitiveLogValue(value)) {
      inlineEntries.push([key, value])
      return
    }
    nestedEntries.push([key, value])
  })
  return { inlineEntries, nestedEntries }
}

function DetailStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

export default function PaymentTransactionsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<TransactionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<TransactionDetail | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = React.useState(false)
  const [detailError, setDetailError] = React.useState<string | null>(null)
  const [expandedLogId, setExpandedLogId] = React.useState<string | null>(null)
  const [isRefreshingStatus, setIsRefreshingStatus] = React.useState(false)
  const noneLabel = t('common.none', 'None')

  const formatLogPrimitiveValue = React.useCallback((value: string | number | boolean | null): string => {
    if (value === null) return noneLabel
    if (typeof value === 'boolean') return value ? t('common.yes', 'Yes') : t('common.no', 'No')
    return String(value)
  }, [noneLabel, t])

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
    })
    if (search.trim()) params.set('search', search.trim())
    if (typeof filterValues.providerKey === 'string' && filterValues.providerKey) {
      params.set('providerKey', filterValues.providerKey)
    }
    if (typeof filterValues.status === 'string' && filterValues.status) {
      params.set('status', filterValues.status)
    }
    const fallback: TransactionsResponse = { items: [], total: 0, page, pageSize: 20, totalPages: 1 }
    const call = await apiCall<TransactionsResponse>(`/api/payment_gateways/transactions?${params.toString()}`, undefined, { fallback })
    if (call.ok && call.result) {
      setRows(Array.isArray(call.result.items) ? call.result.items : [])
      setTotal(call.result.total ?? 0)
      setTotalPages(call.result.totalPages ?? 1)
    } else {
      flash(t('payment_gateways.transactions.error.load', 'Failed to load payment transactions'), 'error')
      setRows([])
      setTotal(0)
      setTotalPages(1)
    }
    setIsLoading(false)
  }, [filterValues.providerKey, filterValues.status, page, search, t])

  const loadDetail = React.useCallback(async (transactionId: string) => {
    setIsLoadingDetail(true)
    setDetailError(null)
    const call = await apiCall<TransactionDetail>(`/api/payment_gateways/transactions/${encodeURIComponent(transactionId)}`, undefined, { fallback: null })
    if (call.ok && call.result) {
      setDetail(call.result)
      setExpandedLogId((current) => (current && call.result?.logs.some((log) => log.id === current) ? current : null))
    } else {
      setDetail(null)
      setDetailError(t('payment_gateways.transactions.error.loadDetail', 'Failed to load transaction details'))
    }
    setIsLoadingDetail(false)
  }, [t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, scopeVersion])

  React.useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      setDetailError(null)
      return
    }
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

  React.useEffect(() => {
    setSelectedId((current) => (current && rows.some((row) => row.id === current) ? current : null))
  }, [rows])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (typeof value === 'string' && value.trim()) next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefreshStatus = React.useCallback(async () => {
    if (!selectedId) return
    setIsRefreshingStatus(true)
    const call = await apiCall(`/api/payment_gateways/status?transactionId=${encodeURIComponent(selectedId)}`, undefined, { fallback: null })
    if (!call.ok) {
      flash(t('payment_gateways.transactions.error.refreshStatus', 'Failed to refresh transaction status'), 'error')
      setIsRefreshingStatus(false)
      return
    }
    await Promise.all([
      loadRows(),
      loadDetail(selectedId),
    ])
    flash(t('payment_gateways.transactions.success.refreshStatus', 'Transaction status refreshed'), 'success')
    setIsRefreshingStatus(false)
  }, [loadDetail, loadRows, selectedId, t])

  const providerOptions = React.useMemo(() => {
    const values = Array.from(new Set(rows.map((row) => row.providerKey).filter(Boolean))).sort()
    return values.map((value) => ({
      label: formatTypeLabel(value),
      value,
    }))
  }, [rows])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'providerKey',
      type: 'select',
      label: t('payment_gateways.transactions.filters.provider', 'Provider'),
      options: [
        { label: t('payment_gateways.transactions.filters.allProviders', 'All providers'), value: '' },
        ...providerOptions,
      ],
    },
    {
      id: 'status',
      type: 'select',
      label: t('payment_gateways.transactions.filters.status', 'Status'),
      options: [
        { label: t('payment_gateways.transactions.filters.allStatuses', 'All statuses'), value: '' },
        { label: t('payment_gateways.status.pending', 'Pending'), value: 'pending' },
        { label: t('payment_gateways.status.authorized', 'Authorized'), value: 'authorized' },
        { label: t('payment_gateways.status.captured', 'Captured'), value: 'captured' },
        { label: t('payment_gateways.status.partially_captured', 'Partially Captured'), value: 'partially_captured' },
        { label: t('payment_gateways.status.refunded', 'Refunded'), value: 'refunded' },
        { label: t('payment_gateways.status.partially_refunded', 'Partially Refunded'), value: 'partially_refunded' },
        { label: t('payment_gateways.status.cancelled', 'Cancelled'), value: 'cancelled' },
        { label: t('payment_gateways.status.failed', 'Failed'), value: 'failed' },
        { label: t('payment_gateways.status.expired', 'Expired'), value: 'expired' },
        { label: t('payment_gateways.status.unknown', 'Unknown'), value: 'unknown' },
      ],
    },
  ], [providerOptions, t])

  const columns = React.useMemo<ColumnDef<TransactionRow>[]>(() => [
    {
      accessorKey: 'paymentId',
      header: t('payment_gateways.transactions.columns.paymentId', 'Payment'),
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="font-medium">{row.original.paymentId}</div>
          <div className="text-xs text-muted-foreground">{row.original.id}</div>
        </div>
      ),
      meta: { maxWidth: '20rem' },
    },
    {
      accessorKey: 'providerKey',
      header: t('payment_gateways.transactions.columns.provider', 'Provider'),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span>{formatTypeLabel(row.original.providerKey)}</span>
        </div>
      ),
    },
    {
      accessorKey: 'unifiedStatus',
      header: t('payment_gateways.transactions.columns.status', 'Status'),
      cell: ({ row }) => (
        <Badge variant="secondary" className={STATUS_STYLES[row.original.unifiedStatus] ?? ''}>
          {t(`payment_gateways.status.${row.original.unifiedStatus}`, formatTypeLabel(row.original.unifiedStatus))}
        </Badge>
      ),
    },
    {
      accessorKey: 'amount',
      header: t('payment_gateways.transactions.columns.amount', 'Amount'),
      cell: ({ row }) => formatAmount(row.original.amount, row.original.currencyCode),
    },
    {
      accessorKey: 'providerSessionId',
      header: t('payment_gateways.transactions.columns.session', 'Session'),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.providerSessionId ?? '—'}
        </span>
      ),
      meta: { maxWidth: '18rem', truncate: true },
    },
    {
      accessorKey: 'updatedAt',
      header: t('payment_gateways.transactions.columns.updatedAt', 'Updated'),
      cell: ({ row }) => formatDateTime(row.original.updatedAt),
    },
  ], [t])

  const selectedSummary = React.useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  )

  return (
    <Page>
      <PageHeader
        title={t('payment_gateways.transactions.title', 'Payment Transactions')}
        description={t('payment_gateways.transactions.description', 'Track all payment-gateway transactions, inspect webhook activity, and review provider logs from one place.')}
      />
      <PageBody className="space-y-6">
        <DataTable
          title={t('payment_gateways.transactions.tableTitle', 'Transactions')}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('payment_gateways.transactions.searchPlaceholder', 'Search by payment, transaction, session, or gateway id')}
          perspective={{ tableId: 'payment_gateways.transactions.list' }}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          onRowClick={(row) => setSelectedId((current) => current === row.id ? null : row.id)}
          rowActions={(row) => (
            <RowActions items={[
              {
                id: 'details',
                label: selectedId === row.id
                  ? t('payment_gateways.transactions.actions.hideDetails', 'Hide details')
                  : t('payment_gateways.transactions.actions.showDetails', 'Show details'),
                onSelect: () => setSelectedId((current) => current === row.id ? null : row.id),
              },
            ]} />
          )}
        />

        {selectedId ? (
          <Card>
            <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>{t('payment_gateways.transactions.detail.title', 'Transaction details')}</CardTitle>
                {selectedSummary ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{selectedSummary.paymentId}</span>
                    <span>•</span>
                    <span>{formatTypeLabel(selectedSummary.providerKey)}</span>
                    <Badge variant="secondary" className={STATUS_STYLES[selectedSummary.unifiedStatus] ?? ''}>
                      {t(`payment_gateways.status.${selectedSummary.unifiedStatus}`, formatTypeLabel(selectedSummary.unifiedStatus))}
                    </Badge>
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRefreshStatus()}
                disabled={isRefreshingStatus || isLoadingDetail}
              >
                {isRefreshingStatus ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {t('payment_gateways.transactions.actions.refreshStatus', 'Refresh status')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingDetail ? <LoadingMessage label={t('payment_gateways.transactions.detail.loading', 'Loading transaction details')} /> : null}
              {!isLoadingDetail && detailError ? <ErrorMessage label={detailError} /> : null}
              {!isLoadingDetail && !detailError && detail ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-4">
                    <DetailStat
                      label={t('payment_gateways.transactions.detail.summary.status', 'Status')}
                      value={(
                        <Badge variant="secondary" className={STATUS_STYLES[detail.transaction.unifiedStatus] ?? ''}>
                          {t(`payment_gateways.status.${detail.transaction.unifiedStatus}`, formatTypeLabel(detail.transaction.unifiedStatus))}
                        </Badge>
                      )}
                    />
                    <DetailStat
                      label={t('payment_gateways.transactions.detail.summary.gatewayStatus', 'Gateway status')}
                      value={detail.transaction.gatewayStatus ?? noneLabel}
                    />
                    <DetailStat
                      label={t('payment_gateways.transactions.detail.summary.amount', 'Amount')}
                      value={formatAmount(detail.transaction.amount, detail.transaction.currencyCode)}
                    />
                    <DetailStat
                      label={t('payment_gateways.transactions.detail.summary.provider', 'Provider')}
                      value={formatTypeLabel(detail.transaction.providerKey)}
                    />
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <div className="space-y-6">
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold">{t('payment_gateways.transactions.detail.identifiers', 'Identifiers')}</h3>
                        <dl className="grid gap-3 md:grid-cols-2">
                          {[
                            [t('payment_gateways.transactions.columns.transactionId', 'Transaction ID'), detail.transaction.id],
                            [t('payment_gateways.transactions.columns.paymentId', 'Payment ID'), detail.transaction.paymentId],
                            [t('payment_gateways.transactions.columns.session', 'Session ID'), detail.transaction.providerSessionId ?? '—'],
                            [t('payment_gateways.transactions.columns.gatewayPaymentId', 'Gateway payment ID'), detail.transaction.gatewayPaymentId ?? '—'],
                            [t('payment_gateways.transactions.columns.gatewayRefundId', 'Gateway refund ID'), detail.transaction.gatewayRefundId ?? '—'],
                            [t('payment_gateways.transactions.columns.redirectUrl', 'Redirect URL'), detail.transaction.redirectUrl ?? '—'],
                            [t('payment_gateways.transactions.columns.createdAt', 'Created at'), formatDateTime(detail.transaction.createdAt)],
                            [t('payment_gateways.transactions.columns.updatedAt', 'Updated at'), formatDateTime(detail.transaction.updatedAt)],
                            [t('payment_gateways.transactions.columns.lastWebhookAt', 'Last webhook'), formatDateTime(detail.transaction.lastWebhookAt)],
                            [t('payment_gateways.transactions.columns.lastPolledAt', 'Last poll'), formatDateTime(detail.transaction.lastPolledAt)],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-lg border bg-muted/20 px-4 py-3">
                              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                              <dd className="mt-1 break-all text-sm">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>

                      <section className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Webhook className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">{t('payment_gateways.transactions.detail.webhooks', 'Webhook activity')}</h3>
                        </div>
                        {detail.transaction.webhookLog && detail.transaction.webhookLog.length > 0 ? (
                          <div className="overflow-hidden rounded-lg border">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b bg-muted/40">
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.eventType', 'Event')}</th>
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.status', 'Status')}</th>
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.processed', 'Processed')}</th>
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.receivedAt', 'Received')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.transaction.webhookLog.map((entry) => (
                                  <tr key={`${entry.idempotencyKey}:${entry.receivedAt}`} className="border-b last:border-0">
                                    <td className="px-4 py-2 font-medium">{entry.eventType}</td>
                                    <td className="px-4 py-2">
                                      <Badge variant="secondary" className={STATUS_STYLES[entry.unifiedStatus] ?? ''}>
                                        {t(`payment_gateways.status.${entry.unifiedStatus}`, formatTypeLabel(entry.unifiedStatus))}
                                      </Badge>
                                    </td>
                                    <td className="px-4 py-2">{entry.processed ? t('common.yes', 'Yes') : t('common.no', 'No')}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{formatDateTime(entry.receivedAt)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{t('payment_gateways.transactions.detail.webhooksEmpty', 'No webhook events have been recorded for this transaction yet.')}</p>
                        )}
                      </section>

                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold">{t('payment_gateways.transactions.detail.logs', 'Gateway logs')}</h3>
                        {detail.logs.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t('payment_gateways.transactions.detail.logsEmpty', 'No transaction-scoped logs are available yet.')}</p>
                        ) : (
                          <div className="overflow-hidden rounded-lg border">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b bg-muted/40">
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.time', 'Time')}</th>
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.level', 'Level')}</th>
                                  <th className="px-4 py-2 text-left font-medium">{t('payment_gateways.transactions.columns.message', 'Message')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.logs.map((log) => {
                                  const isExpanded = expandedLogId === log.id
                                  const metadataEntries = [
                                    [t('payment_gateways.transactions.log.time', 'Time'), formatDateTime(log.createdAt)],
                                    [t('payment_gateways.transactions.log.level', 'Level'), t(`payment_gateways.transactions.level.${log.level}`, log.level)],
                                    [t('payment_gateways.transactions.log.code', 'Code'), log.code ?? null],
                                    [t('payment_gateways.transactions.log.runId', 'Run ID'), log.runId ?? null],
                                    [t('payment_gateways.transactions.log.entityType', 'Entity Type'), log.scopeEntityType ?? null],
                                    [t('payment_gateways.transactions.log.entityId', 'Entity ID'), log.scopeEntityId ?? null],
                                  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
                                  const { inlineEntries, nestedEntries } = splitLogPayload(log.payload)

                                  return (
                                    <React.Fragment key={log.id}>
                                      <tr className="border-b last:border-0">
                                        <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                                        <td className="px-4 py-2">
                                          <Badge variant="secondary" className={LOG_LEVEL_STYLES[log.level] ?? ''}>
                                            {t(`payment_gateways.transactions.level.${log.level}`, log.level)}
                                          </Badge>
                                        </td>
                                        <td className="px-4 py-2">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-auto w-full justify-start gap-2 px-0 py-0 text-left hover:bg-transparent"
                                            onClick={() => setExpandedLogId((current) => current === log.id ? null : log.id)}
                                          >
                                            {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                            <span className="truncate">{log.message}</span>
                                          </Button>
                                        </td>
                                      </tr>
                                      {isExpanded ? (
                                        <tr className="border-b bg-muted/15 last:border-0">
                                          <td colSpan={3} className="px-4 py-4">
                                            <div className="space-y-4 rounded-lg border bg-card p-4">
                                              {metadataEntries.length > 0 ? (
                                                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                  {metadataEntries.map(([label, value]) => (
                                                    <div key={label} className="rounded-md border bg-muted/20 px-3 py-2">
                                                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                                                      <dd className="mt-1 break-all text-sm">{value}</dd>
                                                    </div>
                                                  ))}
                                                </dl>
                                              ) : null}
                                              {inlineEntries.length > 0 ? (
                                                <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                  {inlineEntries.map(([key, value]) => (
                                                    <div key={key} className="rounded-md border bg-muted/20 px-3 py-2">
                                                      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{formatLogDetailLabel(key)}</dt>
                                                      <dd className="mt-1 break-words text-sm">{formatLogPrimitiveValue(value)}</dd>
                                                    </div>
                                                  ))}
                                                </dl>
                                              ) : null}
                                              {nestedEntries.map(([key, value]) => (
                                                <JsonDisplay
                                                  key={key}
                                                  data={value}
                                                  title={formatLogDetailLabel(key)}
                                                  defaultExpanded
                                                  maxInitialDepth={1}
                                                  theme="dark"
                                                  maxHeight="16rem"
                                                  className="p-4"
                                                />
                                              ))}
                                            </div>
                                          </td>
                                        </tr>
                                      ) : null}
                                    </React.Fragment>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="space-y-4">
                      <JsonDisplay
                        data={detail.transaction.gatewayMetadata ?? {}}
                        title={t('payment_gateways.transactions.detail.gatewayMetadata', 'Gateway metadata')}
                        defaultExpanded
                        maxInitialDepth={1}
                        theme="dark"
                        maxHeight="24rem"
                        className="p-4"
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </PageBody>
    </Page>
  )
}
