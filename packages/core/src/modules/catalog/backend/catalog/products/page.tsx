"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, buildCrudExportUrl } from '@open-mercato/ui/backend/utils/crud'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { applyCustomFieldVisibility } from '@open-mercato/ui/backend/utils/customFieldColumns'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { Plus, RefreshCw } from 'lucide-react'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type PricingScope = {
  variant_id?: string | null
  offer_id?: string | null
  channel_id?: string | null
  user_id?: string | null
  user_group_id?: string | null
  customer_id?: string | null
  customer_group_id?: string | null
}

type PricingInfo = {
  kind?: string | null
  currency_code?: string | null
  unit_price_net?: string | null
  unit_price_gross?: string | null
  min_quantity?: number | null
  max_quantity?: number | null
  tax_rate?: string | null
  scope?: PricingScope | null
}

type OfferInfo = {
  id: string
  channelId: string
  title: string
  description?: string | null
  isActive: boolean
}

type ProductRow = {
  id: string
  name: string
  description?: string | null
  code?: string | null
  status_entry_id?: string | null
  primary_currency_code?: string | null
  default_unit?: string | null
  is_configurable?: boolean
  is_active?: boolean
  metadata?: Record<string, unknown> | null
  attribute_schema?: Record<string, unknown> | null
  attribute_values?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
  offers: OfferInfo[]
  pricing: PricingInfo | null
} & Record<string, unknown>

type ProductsResponse = {
  items?: Record<string, unknown>[]
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 25
const ENTITY_ID = E.catalog.catalog_product

function mapApiItem(item: Record<string, unknown>): ProductRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const offers: OfferInfo[] = Array.isArray(item.offers)
    ? item.offers
        .map((offer) => {
          if (!offer || typeof offer !== 'object') return null
          const value = offer as Record<string, unknown>
          const offerId = typeof value.id === 'string' ? value.id : null
          const channelId = typeof value.channelId === 'string' ? value.channelId : null
          if (!offerId || !channelId) return null
          return {
            id: offerId,
            channelId,
            title: typeof value.title === 'string' ? value.title : channelId,
            description: typeof value.description === 'string' ? value.description : null,
            isActive: value.isActive !== false,
          }
        })
        .filter((offer): offer is OfferInfo => !!offer)
    : []
  const pricing: PricingInfo | null =
    item.pricing && typeof item.pricing === 'object'
      ? (item.pricing as PricingInfo)
      : null
  const base: ProductRow = {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    description: typeof item.description === 'string' ? item.description : null,
    code: typeof item.code === 'string' ? item.code : null,
    status_entry_id: typeof item.status_entry_id === 'string' ? item.status_entry_id : null,
    primary_currency_code:
      typeof item.primary_currency_code === 'string' ? item.primary_currency_code : null,
    default_unit: typeof item.default_unit === 'string' ? item.default_unit : null,
    is_configurable: item.is_configurable === true,
    is_active: item.is_active !== false,
    metadata:
      item.metadata && typeof item.metadata === 'object'
        ? (item.metadata as Record<string, unknown>)
        : null,
    attribute_schema:
      item.attribute_schema && typeof item.attribute_schema === 'object'
        ? (item.attribute_schema as Record<string, unknown>)
        : null,
    attribute_values:
      item.attribute_values && typeof item.attribute_values === 'object'
        ? (item.attribute_values as Record<string, unknown>)
        : null,
    created_at: typeof item.created_at === 'string' ? item.created_at : undefined,
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : undefined,
    offers,
    pricing,
  }
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key in base) continue
    extras[key] = value
  }
  return { ...base, ...extras }
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

function renderOffers(offers: OfferInfo[]): React.ReactNode {
  if (!offers.length) return <span className="text-xs text-muted-foreground">—</span>
  const visible = offers.slice(0, 3)
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((offer) => (
        <span
          key={offer.id}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
            offer.isActive ? 'bg-secondary/80 text-secondary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {offer.title}
        </span>
      ))}
      {offers.length > visible.length ? (
        <span className="text-xs text-muted-foreground">+{offers.length - visible.length}</span>
      ) : null}
    </div>
  )
}

function renderPrice(pricing: PricingInfo | null, currency?: string | null, fallback = '—'): React.ReactNode {
  if (!pricing) return <span className="text-xs text-muted-foreground">{fallback}</span>
  const unit = pricing.unit_price_net ?? pricing.unit_price_gross
  if (unit == null) return <span className="text-xs text-muted-foreground">{fallback}</span>
  const formatted = `${currency ?? pricing.currency_code ?? ''} ${unit}`
  const kind = pricing.kind ?? 'list'
  return (
    <div className="flex flex-col">
      <span className="font-medium">{formatted.trim()}</span>
      <span className="text-xs text-muted-foreground">{kind}</span>
    </div>
  )
}

export default function CatalogProductsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ProductRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const { data: customFieldDefs = [] } = useCustomFieldDefs(ENTITY_ID, {
    keyExtras: [scopeVersion, reloadToken],
  })

  const loadChannelOptions = React.useCallback(
    async (term?: string): Promise<FilterOption[]> => {
      try {
        const params = new URLSearchParams({ pageSize: '100', isActive: 'true' })
        if (term && term.trim().length) params.set('search', term.trim())
        const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; code?: string }> }>(
          `/api/sales/channels?${params.toString()}`,
          undefined,
          { errorMessage: t('catalog.products.filters.channelsLoadError', 'Failed to load channels') },
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        return items
          .map((entry) => {
            const value = typeof entry.id === 'string' ? entry.id : null
            if (!value) return null
            const label =
              typeof entry.name === 'string'
                ? entry.name
                : typeof entry.code === 'string'
                  ? entry.code
                  : value
            return { value, label }
          })
          .filter((option): option is FilterOption => !!option)
      } catch {
        return []
      }
    },
    [t],
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    { id: 'status', label: t('catalog.products.filters.status'), type: 'text' },
    { id: 'isActive', label: t('catalog.products.filters.active'), type: 'checkbox' },
    { id: 'configurable', label: t('catalog.products.filters.configurable'), type: 'checkbox' },
    { id: 'channelIds', label: t('catalog.products.filters.channels'), type: 'tags', loadOptions: loadChannelOptions },
  ], [loadChannelOptions, t])

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(() => {
    const base: ColumnDef<ProductRow>[] = [
      {
        accessorKey: 'name',
        header: t('catalog.products.table.name'),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name || '—'}</span>
            {row.original.description ? (
              <span className="text-xs text-muted-foreground">{row.original.description}</span>
            ) : null}
          </div>
        ),
        meta: { sticky: true },
      },
      {
        accessorKey: 'code',
        header: t('catalog.products.table.code'),
        cell: ({ getValue }) => {
          const value = getValue()
          return value ? <span className="font-mono text-xs">{String(value)}</span> : <span className="text-xs text-muted-foreground">—</span>
        },
      },
      {
        accessorKey: 'is_configurable',
        header: t('catalog.products.table.configurable'),
        cell: ({ row }) => <BooleanIcon value={!!row.original.is_configurable} />,
      },
      {
        accessorKey: 'is_active',
        header: t('catalog.products.table.active'),
        cell: ({ row }) => <BooleanIcon value={!!row.original.is_active} />,
      },
      {
        accessorKey: 'pricing',
        header: t('catalog.products.table.price'),
        cell: ({ row }) => renderPrice(row.original.pricing, row.original.primary_currency_code),
      },
      {
        accessorKey: 'offers',
        header: t('catalog.products.table.channels'),
        cell: ({ row }) => renderOffers(row.original.offers),
      },
      {
        accessorKey: 'updated_at',
        header: t('catalog.products.table.updatedAt'),
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.updated_at)}</span>,
      },
    ]
    return applyCustomFieldVisibility(base, customFieldDefs)
  }, [customFieldDefs, t])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

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
    const status = filterValues.status
    if (typeof status === 'string' && status.trim()) {
      params.set('status', status.trim())
    }
    if (filterValues.isActive === true) params.set('isActive', 'true')
    if (filterValues.isActive === false) params.set('isActive', 'false')
    if (filterValues.configurable === true) params.set('configurable', 'true')
    if (filterValues.configurable === false) params.set('configurable', 'false')
    if (Array.isArray(filterValues.channelIds) && filterValues.channelIds.length) {
      const values = filterValues.channelIds
        .map((value) => (typeof value === 'string' ? value : null))
        .filter((value): value is string => !!value)
      if (values.length) params.set('channelIds', values.join(','))
    }
    Object.entries(filterValues).forEach(([key, value]) => {
      if (!key.startsWith('cf_') || value == null) return
      if (Array.isArray(value)) {
        const entries = value
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry || '').trim()))
          .filter((entry) => entry.length > 0)
        if (entries.length) params.set(key, entries.join(','))
      } else if (typeof value === 'string' && value.trim()) {
        params.set(key, value.trim())
      }
    })
    return params.toString()
  }, [filterValues, page, search, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: ProductsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<ProductsResponse>(
          `/api/catalog/products?${queryParams}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const message = t('catalog.products.list.error.load', 'Failed to load products')
          flash(message, 'error')
          return
        }
        const payload = call.result ?? fallback
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        const mapped = items
          .map((item) => mapApiItem(item as Record<string, unknown>))
          .filter((row): row is ProductRow => !!row)
        setRows(mapped)
        setTotal(typeof payload.total === 'number' ? payload.total : mapped.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : t('catalog.products.list.error.load', 'Failed to load products')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [queryParams, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: ProductRow) => {
    if (!window.confirm(t('catalog.products.list.deleteConfirm', 'Delete this product?'))) return
    try {
      await deleteCrud('catalog/products', row.id, {
        errorMessage: t('catalog.products.list.error.delete', 'Failed to delete product'),
      })
      flash(t('catalog.products.flash.deleted', 'Product deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('catalog.products.list.error.delete', 'Failed to delete product')
      flash(message, 'error')
    }
  }, [t])

  const currentParams = React.useMemo(() => Object.fromEntries(new URLSearchParams(queryParams)), [queryParams])

  const exportConfig = React.useMemo(() => ({
    view: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('catalog/products', { ...currentParams, exportScope: 'view' }, format),
    },
    full: {
      getUrl: (format: DataTableExportFormat) =>
        buildCrudExportUrl('catalog/products', { ...currentParams, exportScope: 'full', all: 'true' }, format),
    },
  }), [currentParams])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('catalog.products.page.title', 'Products & services')}
          actions={(
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('catalog.products.actions.refresh', 'Refresh')}
              </Button>
              <Button size="sm" asChild>
                <Link href="/backend/catalog/products/create">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('catalog.products.actions.create', 'Create')}
                </Link>
              </Button>
            </div>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={handleSearchChange}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          exportConfig={exportConfig}
          isLoading={isLoading}
          perspective={{ tableId: 'catalog.products.list' }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('catalog.products.table.actions.edit', 'Edit'),
                  href: `/backend/catalog/products/${row.id}`,
                },
                {
                  label: t('catalog.products.table.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
        />
      </PageBody>
    </Page>
  )
}
