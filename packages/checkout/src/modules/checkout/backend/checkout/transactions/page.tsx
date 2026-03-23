"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'

type TransactionRow = {
  id: string
  linkId: string
  linkName?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  amount?: number | null
  currencyCode: string
  status: string
  paymentStatus?: string | null
  createdAt?: string | null
}

type TransactionsResponse = {
  items: TransactionRow[]
  total: number
  totalPages: number
  canViewPii?: boolean
}

type LinkLookupResponse = {
  id: string
  name?: string | null
}

type LinkListResponse = {
  items?: Array<Record<string, unknown>>
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
}

function formatAmount(amount: number | null | undefined, currencyCode: string): string {
  const resolved = typeof amount === 'number' ? amount : 0
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(resolved)
  } catch {
    return `${resolved.toFixed(2)} ${currencyCode}`
  }
}

export default function CheckoutTransactionsPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const initialLinkId = React.useMemo(() => {
    const raw = searchParams.get('linkId')
    return raw && raw.trim().length > 0 ? raw.trim() : ''
  }, [searchParams])
  const [rows, setRows] = React.useState<TransactionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>(() => (initialLinkId ? { linkId: initialLinkId } : {}))
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [canViewPii, setCanViewPii] = React.useState(false)
  const [linkLabels, setLinkLabels] = React.useState<Record<string, string>>({})

  const rememberLinkOptions = React.useCallback((options: Array<{ value: string; label: string }>) => {
    if (!options.length) return
    setLinkLabels((prev) => {
      let changed = false
      const next = { ...prev }
      for (const option of options) {
        if (!option.value || !option.label) continue
        if (next[option.value] === option.label) continue
        next[option.value] = option.label
        changed = true
      }
      return changed ? next : prev
    })
  }, [])

  const loadLinkOptions = React.useCallback(async (query?: string): Promise<Array<{ value: string; label: string }>> => {
    const params = new URLSearchParams({ page: '1', pageSize: '20' })
    if (query && query.trim().length > 0) params.set('search', query.trim())
    try {
      const call = await apiCall<LinkListResponse>(`/api/checkout/links?${params.toString()}`)
      if (!call.ok) return []
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      const options = items
        .map((item): { value: string; label: string } | null => {
          const id = typeof item.id === 'string' ? item.id : null
          const name = typeof item.name === 'string' ? item.name : null
          if (!id || !name) return null
          return { value: id, label: name }
        })
        .filter((option): option is { value: string; label: string } => option !== null)
      rememberLinkOptions(options)
      return options
    } catch {
      return []
    }
  }, [rememberLinkOptions])

  React.useEffect(() => {
    if (!initialLinkId || linkLabels[initialLinkId]) return
    let active = true
    void readApiResultOrThrow<LinkLookupResponse>(`/api/checkout/links/${encodeURIComponent(initialLinkId)}`)
      .then((result) => {
        if (!active) return
        const name = typeof result.name === 'string' ? result.name.trim() : ''
        if (!name) return
        rememberLinkOptions([{ value: initialLinkId, label: name }])
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [initialLinkId, linkLabels, rememberLinkOptions])

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'linkId',
      label: t('checkout.admin.transactions.filters.link'),
      type: 'combobox',
      placeholder: t('checkout.admin.payLinks.searchPlaceholder'),
      loadOptions: loadLinkOptions,
      formatValue: (value) => linkLabels[value] ?? value,
    },
    {
      id: 'status',
      label: t('checkout.admin.transactions.filters.status'),
      type: 'select',
      options: [
        { value: 'pending', label: t('checkout.admin.transactions.status.pending') },
        { value: 'processing', label: t('checkout.admin.transactions.status.processing') },
        { value: 'completed', label: t('checkout.admin.transactions.status.completed') },
        { value: 'failed', label: t('checkout.admin.transactions.status.failed') },
        { value: 'cancelled', label: t('checkout.admin.transactions.status.cancelled') },
        { value: 'expired', label: t('checkout.admin.transactions.status.expired') },
      ],
    },
  ], [linkLabels, loadLinkOptions, t])

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
      search,
    })
    if (typeof filters.status === 'string' && filters.status) params.set('status', filters.status)
    if (typeof filters.linkId === 'string' && filters.linkId) params.set('linkId', filters.linkId)
    const result = await readApiResultOrThrow<TransactionsResponse>(`/api/checkout/transactions?${params.toString()}`)
    setRows(result.items ?? [])
    rememberLinkOptions(
      (result.items ?? [])
        .map((item) => {
          if (!item.linkId || !item.linkName) return null
          return { value: item.linkId, label: item.linkName }
        })
        .filter((option): option is { value: string; label: string } => option !== null),
    )
    setTotal(result.total ?? 0)
    setTotalPages(result.totalPages ?? 1)
    setCanViewPii(result.canViewPii === true)
    setLoading(false)
  }, [filters.linkId, filters.status, page, rememberLinkOptions, search])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const columns = React.useMemo<ColumnDef<TransactionRow>[]>(() => {
    const baseColumns: ColumnDef<TransactionRow>[] = [
      { accessorKey: 'linkName', header: t('checkout.admin.transactions.columns.link') },
    ]
    if (canViewPii) {
      baseColumns.push(
        {
          id: 'customer',
          header: t('checkout.admin.transactions.columns.customer'),
          cell: ({ row }) => [row.original.firstName, row.original.lastName].filter(Boolean).join(' ') || t('checkout.common.emptyValue'),
        },
        {
          accessorKey: 'email',
          header: t('checkout.admin.transactions.columns.email'),
          cell: ({ row }) => row.original.email ?? t('checkout.common.emptyValue'),
        },
      )
    }
    baseColumns.push(
      {
        accessorKey: 'amount',
        header: t('checkout.admin.transactions.columns.amount'),
        cell: ({ row }) => formatAmount(row.original.amount, row.original.currencyCode),
      },
      {
        accessorKey: 'status',
        header: t('checkout.admin.transactions.columns.status'),
        cell: ({ row }) => <Badge variant="secondary">{t(`checkout.admin.transactions.status.${row.original.status}`, row.original.status)}</Badge>,
      },
      {
        accessorKey: 'paymentStatus',
        header: t('checkout.admin.transactions.columns.paymentStatus'),
        cell: ({ row }) => row.original.paymentStatus ?? t('checkout.common.emptyValue'),
      },
      {
        accessorKey: 'createdAt',
        header: t('checkout.admin.transactions.columns.date'),
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    )
    return baseColumns
  }, [canViewPii, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('checkout.admin.transactions.title')}
          columns={columns}
          data={rows}
          isLoading={loading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('checkout.admin.transactions.searchPlaceholder')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(next) => { setFilters(next); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          pagination={{ page, pageSize: 25, total, totalPages, onPageChange: setPage }}
          perspective={{ tableId: 'checkout-transactions' }}
          rowClickActionIds={['view']}
          rowActions={(row) => <RowActions items={[{ id: 'view', label: t('checkout.admin.transactions.actions.viewDetail'), href: `/backend/checkout/transactions/${encodeURIComponent(row.id)}` }]} />}
        />
      </PageBody>
    </Page>
  )
}
