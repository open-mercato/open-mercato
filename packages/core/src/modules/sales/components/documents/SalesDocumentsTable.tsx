"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  DictionaryValue,
  type DictionaryMap,
  createDictionaryMap,
  normalizeDictionaryEntries,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

type SalesDocumentKind = 'order' | 'quote'

type FilterOption = { value: string; label: string }

type CustomerSnapshot = {
  customer?: {
    displayName?: string | null
    primaryEmail?: string | null
  } | null
  contact?: {
    firstName?: string | null
    lastName?: string | null
    preferredName?: string | null
  } | null
}

type ApiDocument = {
  id: string
  orderNumber?: string | null
  quoteNumber?: string | null
  status?: string | null
  customerEntityId?: string | null
  customerSnapshot?: Record<string, unknown> | null
  channelId?: string | null
  lineItemCount?: number | null
  grandTotalNetAmount?: number | null
  grandTotalGrossAmount?: number | null
  currencyCode?: string | null
  placedAt?: string | null
  validUntil?: string | null
  validFrom?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

type DocumentsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type SalesDocumentRow = {
  id: string
  number: string
  status?: string | null
  customerName?: string | null
  customerEmail?: string | null
  channelId?: string | null
  lineItemCount?: number | null
  totalNet?: number | null
  totalGross?: number | null
  currency?: string | null
  date?: string | null
}

const PAGE_SIZE = 20

function resolveCustomerName(snapshot: CustomerSnapshot | null | undefined, fallback?: string | null) {
  if (!snapshot) return fallback ?? null
  const base = snapshot.customer?.displayName ?? null
  if (base) return base
  const contact = snapshot.contact
  if (contact) {
    const parts = [contact.preferredName, contact.firstName, contact.lastName].filter(
      (part) => part && part.trim().length
    ) as string[]
    if (parts.length) return parts.join(' ')
  }
  return fallback ?? null
}

function resolveCustomerEmail(snapshot: CustomerSnapshot | null | undefined) {
  if (!snapshot) return null
  if (snapshot.customer?.primaryEmail) return snapshot.customer.primaryEmail
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined, fallback = '—') {
  if (amount == null || Number.isNaN(amount)) return fallback
  try {
    if (currency && currency.trim().length) {
      const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
      return formatter.format(amount)
    }
    return new Intl.NumberFormat(undefined, { style: 'decimal', maximumFractionDigits: 2 }).format(amount)
  } catch {
    return String(amount)
  }
}

function mergeOptions(existing: FilterOption[], next: FilterOption[]): FilterOption[] {
  const map = new Map<string, FilterOption>()
  existing.forEach((opt) => map.set(opt.value, opt))
  next.forEach((opt) => map.set(opt.value, opt))
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function normalizeNumberInput(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function SalesDocumentsTable({ kind }: { kind: SalesDocumentKind }) {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<SalesDocumentRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setLoading] = React.useState(false)
  const [cacheStatus, setCacheStatus] = React.useState<'hit' | 'miss' | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [channelOptions, setChannelOptions] = React.useState<FilterOption[]>([])
  const [tagOptions, setTagOptions] = React.useState<FilterOption[]>([])
  const [customerOptions, setCustomerOptions] = React.useState<FilterOption[]>([])
  const [statusMap, setStatusMap] = React.useState<DictionaryMap>({})

  const resource = kind === 'order' ? 'orders' : 'quotes'
  const entityId = kind === 'order' ? E.sales.sales_order : E.sales.sales_quote
  const title = kind === 'order'
    ? t('sales.documents.list.ordersTitle', 'Sales orders')
    : t('sales.documents.list.quotesTitle', 'Sales quotes')
  const subtitle = t(
    'sales.documents.list.subtitle',
    'Review documents with customer context, totals, and channels.'
  )

  const fetchChannelOptions = React.useCallback(async (query?: string): Promise<FilterOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (query && query.trim()) params.set('search', query.trim())
    try {
      const call = await apiCall<{ items?: unknown[] }>(`/api/sales/channels?${params.toString()}`)
      if (!call.ok) return []
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      return items
        .map((item: any): FilterOption | null => {
          const id = typeof item?.id === 'string' ? item.id : null
          const name = typeof item?.name === 'string' ? item.name : null
          if (!id || !name) return null
          return { value: id, label: name }
        })
        .filter((opt): opt is FilterOption => opt !== null)
    } catch {
      return []
    }
  }, [])

  const fetchTagOptions = React.useCallback(async (query?: string): Promise<FilterOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (query && query.trim()) params.set('search', query.trim())
    try {
      const call = await apiCall<{ items?: unknown[] }>(`/api/sales/tags?${params.toString()}`)
      if (!call.ok) return []
      const items = Array.isArray(call.result?.items) ? call.result!.items : []
      return items
        .map((item: any): FilterOption | null => {
          const id = typeof item?.id === 'string' ? item.id : null
          const label = typeof item?.label === 'string' ? item.label : null
          if (!id || !label) return null
          return { value: id, label }
        })
        .filter((opt): opt is FilterOption => opt !== null)
    } catch {
      return []
    }
  }, [])

  const fetchCustomerOptions = React.useCallback(async (query?: string): Promise<FilterOption[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '20' })
    if (query && query.trim().length) params.set('search', query.trim())
    try {
      const [people, companies] = await Promise.all([
        apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`),
        apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`),
      ])
      const peopleItems = Array.isArray(people.result?.items) ? people.result?.items ?? [] : []
      const companyItems = Array.isArray(companies.result?.items) ? companies.result?.items ?? [] : []
      const parseOption = (item: any, kind: 'person' | 'company'): FilterOption | null => {
        const id = typeof item?.id === 'string' ? item.id : null
        if (!id) return null
        const name =
          typeof item?.display_name === 'string' && item.display_name.trim().length
            ? item.display_name
            : typeof item?.name === 'string' && item.name.trim().length
              ? item.name
              : id
        const email =
          typeof item?.primary_email === 'string' && item.primary_email.trim().length
            ? item.primary_email.trim()
            : null
        const label = email ? `${name} (${email})` : name
        return { value: id, label: kind === 'company' ? label : label }
      }
      const options = [...peopleItems.map((i) => parseOption(i, 'person')), ...companyItems.map((i) => parseOption(i, 'company'))]
        .filter((opt): opt is FilterOption => !!opt)
      return options
    } catch {
      return []
    }
  }, [])

  const loadStatusMap = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/order-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      const entries = normalizeDictionaryEntries(response.result?.items ?? [])
      setStatusMap(createDictionaryMap(entries))
    } catch (err) {
      console.error('sales.documents.statuses.load', err)
      setStatusMap({})
    }
  }, [])

  const loadChannelOptions = React.useCallback(
    async (query?: string) => {
      const opts = await fetchChannelOptions(query)
      if (opts.length) setChannelOptions((prev) => mergeOptions(prev, opts))
      return opts
    },
    [fetchChannelOptions]
  )

  const loadTagOptions = React.useCallback(
    async (query?: string) => {
      const opts = await fetchTagOptions(query)
      if (opts.length) setTagOptions((prev) => mergeOptions(prev, opts))
      return opts
    },
    [fetchTagOptions]
  )

  const loadCustomerOptions = React.useCallback(
    async (query?: string) => {
      const opts = await fetchCustomerOptions(query)
      if (opts.length) setCustomerOptions((prev) => mergeOptions(prev, opts))
      return opts
    },
    [fetchCustomerOptions]
  )

  React.useEffect(() => {
    loadChannelOptions().catch(() => {})
    loadTagOptions().catch(() => {})
    loadCustomerOptions().catch(() => {})
    loadStatusMap().catch(() => setStatusMap({}))
  }, [loadChannelOptions, loadCustomerOptions, loadStatusMap, loadTagOptions, scopeVersion])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'channelId',
      label: t('sales.documents.list.filters.channel', 'Channel'),
      type: 'select',
      options: channelOptions,
      loadOptions: loadChannelOptions,
    },
    {
      id: 'date',
      label: t('sales.documents.list.filters.date', 'Date'),
      type: 'dateRange',
    },
    {
      id: 'lineItemCountMin',
      label: t('sales.documents.list.filters.itemsMin', 'Min items'),
      type: 'text',
    },
    {
      id: 'lineItemCountMax',
      label: t('sales.documents.list.filters.itemsMax', 'Max items'),
      type: 'text',
    },
    {
      id: 'totalNetMin',
      label: t('sales.documents.list.filters.totalNetMin', 'Min total (net)'),
      type: 'text',
    },
    {
      id: 'totalNetMax',
      label: t('sales.documents.list.filters.totalNetMax', 'Max total (net)'),
      type: 'text',
    },
    {
      id: 'totalGrossMin',
      label: t('sales.documents.list.filters.totalGrossMin', 'Min total (gross)'),
      type: 'text',
    },
    {
      id: 'totalGrossMax',
      label: t('sales.documents.list.filters.totalGrossMax', 'Max total (gross)'),
      type: 'text',
    },
    {
      id: 'customerId',
      label: t('sales.documents.list.filters.customer', 'Customer'),
      type: 'tags',
      options: customerOptions,
      loadOptions: loadCustomerOptions,
      placeholder: t('sales.documents.list.filters.customerPlaceholder', 'Search customers'),
      formatValue: (val: string) => {
        const match = customerOptions.find((opt) => opt.value === val)
        return match?.label ?? val
      },
    },
    {
      id: 'tagIds',
      label: t('sales.documents.list.filters.tags', 'Tags'),
      type: 'tags',
      options: tagOptions,
      loadOptions: loadTagOptions,
    },
  ], [channelOptions, loadChannelOptions, loadTagOptions, tagOptions, t])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    if (search.trim()) params.set('search', search.trim())
    const sort = sorting[0]
    if (sort?.id) {
      params.set('sortField', sort.id)
      params.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    const channelId = typeof filterValues.channelId === 'string' ? filterValues.channelId : ''
    if (channelId) params.set('channelId', channelId)
    const customerIds = Array.isArray(filterValues.customerId)
      ? filterValues.customerId
          .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
          .filter((value) => value.length > 0)
      : []
    if (customerIds.length > 0) {
      params.set('customerId', customerIds[0])
    }
    const date = filterValues.date
    if (date && typeof date === 'object') {
      if (date.from) params.set('dateFrom', date.from)
      if (date.to) params.set('dateTo', date.to)
    }
    const numberFilters: Array<[keyof FilterValues, string]> = [
      ['lineItemCountMin', 'lineItemCountMin'],
      ['lineItemCountMax', 'lineItemCountMax'],
      ['totalNetMin', 'totalNetMin'],
      ['totalNetMax', 'totalNetMax'],
      ['totalGrossMin', 'totalGrossMin'],
      ['totalGrossMax', 'totalGrossMax'],
    ]
    numberFilters.forEach(([key, queryKey]) => {
      const value = normalizeNumberInput((filterValues as any)[key])
      if (value != null) params.set(queryKey, String(value))
    })
    const tagIds = Array.isArray(filterValues.tagIds)
      ? filterValues.tagIds.map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim())).filter((v) => v.length > 0)
      : []
    if (tagIds.length > 0) {
      params.set('tagIds', tagIds.join(','))
    }
    Object.entries(filterValues).forEach(([key, value]) => {
      if (!key.startsWith('cf_') || value == null) return
      if (Array.isArray(value)) {
        const normalized = value
          .map((item) => {
            if (item == null) return ''
            if (typeof item === 'string') return item.trim()
            return String(item).trim()
          })
          .filter((item) => item.length > 0)
        if (normalized.length) params.set(key, normalized.join(','))
      } else if (typeof value === 'object') {
        return
      } else if (value !== '') {
        const stringValue = typeof value === 'string' ? value.trim() : String(value)
        if (stringValue) params.set(key, stringValue)
      }
    })
    return params.toString()
  }, [filterValues, page, search, sorting])

  const currentParams = React.useMemo(() => Object.fromEntries(new URLSearchParams(queryParams)), [queryParams])

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl(`sales/${resource}`, { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl(`sales/${resource}`, { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams, resource])

  const mapApiDocument = React.useCallback(
    (item: Record<string, unknown>): SalesDocumentRow => {
      const doc = item as ApiDocument
      const id = typeof doc.id === 'string' ? doc.id : ''
      const number = kind === 'order'
        ? doc.orderNumber ?? (item as any)?.order_number ?? id
        : doc.quoteNumber ?? (item as any)?.quote_number ?? id
      const customerSnapshot = (doc.customerSnapshot ?? null) as CustomerSnapshot | null
      const customerName = resolveCustomerName(customerSnapshot, doc.customerEntityId ?? null)
      const customerEmail = resolveCustomerEmail(customerSnapshot)
      const totalNet = toNumber(doc.grandTotalNetAmount)
      const totalGross = toNumber(doc.grandTotalGrossAmount)
      const placedAt = doc.placedAt ?? null
      const validUntil = doc.validUntil ?? null
      const createdAt = doc.createdAt ?? null
      const date = placedAt ?? validUntil ?? createdAt ?? null
      return {
        id,
        number,
        status: doc.status ?? null,
        customerName,
        customerEmail,
        channelId: doc.channelId ?? null,
        lineItemCount: doc.lineItemCount ?? null,
        totalNet,
        totalGross,
        currency: doc.currencyCode ?? null,
        date,
      }
    },
    [kind]
  )

  const loadDocuments = React.useCallback(async () => {
    setLoading(true)
    setCacheStatus(null)
    try {
      const call = await apiCall<DocumentsResponse>(`/api/sales/${resource}?${queryParams}`)
      if (!call.ok) {
        flash(t('sales.documents.list.errors.load', 'Failed to load documents.'), 'error')
        setRows([])
        setTotal(0)
        setTotalPages(1)
        return
      }
      const payload = call.result ?? {}
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map((item) => mapApiDocument(item)))
      const count = typeof payload.total === 'number' ? payload.total : items.length
      setTotal(count)
      const pages = typeof payload.totalPages === 'number'
        ? payload.totalPages
        : Math.max(1, Math.ceil(count / PAGE_SIZE))
      setTotalPages(pages)
      setCacheStatus(call.cacheStatus ?? null)
    } catch (err) {
      console.error('sales.documents.list', err)
      flash(t('sales.documents.list.errors.load', 'Failed to load documents.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [mapApiDocument, queryParams, resource, t])

  React.useEffect(() => {
    void loadDocuments()
  }, [loadDocuments, reloadToken, scopeVersion])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDelete = React.useCallback(
    async (row: SalesDocumentRow) => {
      const confirmMessage =
        kind === 'order'
          ? t(
              'sales.documents.list.table.deleteOrderConfirm',
              'Delete this sales order? Related shipments, payments, addresses, and items will be removed.'
            )
          : t(
              'sales.documents.list.table.deleteQuoteConfirm',
              'Delete this sales quote? Related addresses, comments, and items will be removed.'
            )
      if (typeof window !== 'undefined' && !window.confirm(confirmMessage)) return
      try {
        const result = await deleteCrud(`sales/${resource}`, row.id, {
          errorMessage: t('sales.documents.list.table.deleteError', 'Failed to delete document.'),
        })
        if (result.ok) {
          flash(
            kind === 'order'
              ? t('sales.documents.list.table.orderDeleted', 'Sales order deleted.')
              : t('sales.documents.list.table.quoteDeleted', 'Sales quote deleted.'),
            'success'
          )
          handleRefresh()
        }
      } catch (err) {
        console.error('sales.documents.delete', err)
        flash(t('sales.documents.list.table.deleteError', 'Failed to delete document.'), 'error')
      }
    },
    [handleRefresh, kind, resource, t]
  )

  const handleRowClick = React.useCallback((row: SalesDocumentRow) => {
    router.push(`/backend/sales/${resource}/${row.id}?kind=${kind}`)
  }, [kind, resource, router])

  const columns = React.useMemo<ColumnDef<SalesDocumentRow>[]>(() => [
    {
      id: 'number',
      accessorKey: 'number',
      header: kind === 'order'
        ? t('sales.documents.list.table.order', 'Order')
        : t('sales.documents.list.table.quote', 'Quote'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-semibold">{row.original.number}</span>
          {row.original.status ? (
            <DictionaryValue
              value={row.original.status}
              map={statusMap}
              fallback={<span className="text-xs text-muted-foreground">{row.original.status}</span>}
              className="text-xs text-muted-foreground font-medium"
              iconWrapperClassName="inline-flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground"
              iconClassName="h-3.5 w-3.5"
              colorClassName="h-3 w-3 rounded-full border border-border/70"
            />
          ) : null}
        </div>
      ),
      meta: { sticky: true },
    },
    {
      accessorKey: 'customerName',
      header: t('sales.documents.list.table.customer', 'Customer'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {row.original.customerName ?? t('sales.documents.list.table.noCustomer', 'No customer')}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.original.customerEmail ?? t('sales.documents.list.table.noEmail', 'No email')}
          </span>
        </div>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'channelId',
      header: t('sales.documents.list.table.channel', 'Channel'),
      cell: ({ row }) => {
        const channelId = row.original.channelId
        if (!channelId) return <span className="text-xs text-muted-foreground">{t('sales.documents.list.table.unassigned', 'Unassigned')}</span>
        const channel = channelOptions.find((opt) => opt.value === channelId)
        return (
          <span className="text-sm">{channel?.label ?? channelId}</span>
        )
      },
      enableSorting: false,
    },
    {
      id: 'lineItemCount',
      accessorKey: 'lineItemCount',
      header: t('sales.documents.list.table.items', 'Items'),
      cell: ({ row }) => (
        <span className="text-sm font-semibold">{typeof row.original.lineItemCount === 'number' ? row.original.lineItemCount : '—'}</span>
      ),
    },
    {
      id: 'grandTotalNetAmount',
      accessorKey: 'totalNet',
      header: t('sales.documents.list.table.totalNet', 'Total (net)'),
      cell: ({ row }) => (
        <span className="text-sm">{formatCurrency(row.original.totalNet ?? null, row.original.currency)}</span>
      ),
    },
    {
      id: 'grandTotalGrossAmount',
      accessorKey: 'totalGross',
      header: t('sales.documents.list.table.totalGross', 'Total (gross)'),
      cell: ({ row }) => (
        <span className="text-sm">{formatCurrency(row.original.totalGross ?? null, row.original.currency)}</span>
      ),
    },
    {
      id: 'createdAt',
      accessorKey: 'date',
      header: t('sales.documents.list.table.date', 'Date'),
      cell: ({ row }) =>
        row.original.date
          ? <span className="text-xs text-muted-foreground">{new Date(row.original.date).toLocaleString()}</span>
          : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [channelOptions, kind, statusMap, t])

  const emptyLabel = kind === 'order'
    ? t('sales.documents.list.table.emptyOrders', 'No orders yet.')
    : t('sales.documents.list.table.emptyQuotes', 'No quotes yet.')

  return (
    <Page>
      <PageBody>
        <DataTable<SalesDocumentRow>
          title={(
            <div className="flex flex-col">
              <span>{title}</span>
              <span className="text-sm font-normal text-muted-foreground">{subtitle}</span>
            </div>
          )}
          actions={(
            <Button asChild>
              <Link href={`/backend/sales/documents/create?kind=${kind}`}>
                {t('sales.documents.create.title', 'Create sales document')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={
            kind === 'order'
              ? t('sales.documents.list.search.orders', 'Search orders…')
              : t('sales.documents.list.search.quotes', 'Search quotes…')
          }
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          entityId={entityId}
          exporter={exportConfig}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
            cacheStatus,
          }}
          refreshButton={{
            label: t('sales.documents.list.table.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('sales.documents.list.table.open', 'Open'),
                  href: `/backend/sales/${resource}/${row.id}?kind=${kind}`,
                },
                {
                  label:
                    kind === 'order'
                      ? t('sales.documents.list.table.deleteOrder', 'Delete order')
                      : t('sales.documents.list.table.deleteQuote', 'Delete quote'),
                  onSelect: () => handleDelete(row),
                },
              ]}
            />
          )}
          onRowClick={handleRowClick}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}

export default SalesDocumentsTable
