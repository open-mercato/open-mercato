"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { FilterOption } from '@open-mercato/ui/backend/FilterOverlay'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { mapOfferRow, renderOfferPriceSummary, type OfferRow } from '@open-mercato/core/modules/sales/components/channels/offerTableUtils'

type OffersResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

const PAGE_SIZE = 25

export default function SalesChannelOffersListPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<OfferRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [channelOptions, setChannelOptions] = React.useState<Map<string, FilterOption>>(new Map())

  const selectedChannelIds = React.useMemo(() => {
    if (!Array.isArray(filterValues.channelIds)) return []
    return filterValues.channelIds
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value): value is string => value.length > 0)
  }, [filterValues])

  const upsertChannelOptions = React.useCallback((options: FilterOption[]) => {
    if (!options.length) return
    setChannelOptions((prev) => {
      const next = new Map(prev)
      options.forEach((option) => {
        if (!option.value) return
        next.set(option.value, option)
      })
      return next
    })
  }, [])

  const loadChannelOptions = React.useCallback(async (term?: string): Promise<FilterOption[]> => {
    try {
      const params = new URLSearchParams({ pageSize: '100', isActive: 'true' })
      if (term && term.trim().length) params.set('search', term.trim())
      const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; code?: string; description?: string | null }> }>(
        `/api/sales/channels?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.channels.offers.filters.channelsLoadError', 'Failed to load channels') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      const options = items
        .map((entry) => {
          const value = typeof entry.id === 'string' ? entry.id : null
          if (!value) return null
          const label =
            typeof entry.name === 'string'
              ? entry.name
              : typeof entry.code === 'string'
                ? entry.code
                : value
          const description =
            typeof entry.code === 'string' && entry.code !== label
              ? entry.code
              : typeof entry.description === 'string' && entry.description.trim().length
                ? entry.description
                : null
          return { value, label, description }
        })
        .filter((option): option is FilterOption => !!option)
      upsertChannelOptions(options)
      return options
    } catch (err) {
      console.warn('[sales.channels.offers] failed to load channel options', err)
      return []
    }
  }, [t, upsertChannelOptions])

  const ensureChannelMetadata = React.useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !channelOptions.has(id))
    if (!missing.length) return
    try {
      const params = new URLSearchParams({
        ids: missing.join(','),
        pageSize: String(Math.min(Math.max(missing.length, 1), 100)),
      })
      const payload = await readApiResultOrThrow<{ items?: Array<{ id?: string; name?: string; code?: string; description?: string | null }> }>(
        `/api/sales/channels?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.channels.offers.filters.channelsLoadError', 'Failed to load channels') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      const options = items
        .map((entry) => {
          const value = typeof entry.id === 'string' ? entry.id : null
          if (!value) return null
          const label =
            typeof entry.name === 'string'
              ? entry.name
              : typeof entry.code === 'string'
                ? entry.code
                : value
          const description =
            typeof entry.code === 'string' && entry.code !== label
              ? entry.code
              : typeof entry.description === 'string' && entry.description.trim().length
                ? entry.description
                : null
          return { value, label, description }
        })
        .filter((option): option is FilterOption => !!option)
      upsertChannelOptions(options)
    } catch (err) {
      console.warn('[sales.channels.offers] failed to hydrate channel metadata', err)
    }
  }, [channelOptions, t, upsertChannelOptions])

  const columns = React.useMemo<ColumnDef<OfferRow>[]>(() => [
    {
      accessorKey: 'title',
      header: t('sales.channels.offers.table.offer', 'Offer'),
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          {row.original.productMediaUrl ? (
            <img
              src={row.original.productMediaUrl}
              alt={row.original.productTitle ?? row.original.title}
              className="h-12 w-12 rounded border object-cover"
            />
          ) : (
            <div className="h-12 w-12 rounded border bg-muted" />
          )}
          <div className="flex flex-col gap-1">
            <div className="flex flex-col">
              <span className="font-medium">{row.original.title}</span>
              <div className="text-xs text-muted-foreground">
                {row.original.productTitle ?? t('sales.channels.offers.table.emptyProduct', 'Unlinked product')}
              </div>
            </div>
          </div>
        </div>
      ),
      meta: { sticky: true },
    },
    {
      accessorKey: 'pricing',
      header: t('sales.channels.offers.table.pricing', 'Prices'),
      cell: ({ row }) => (
        <div className="text-sm">{renderOfferPriceSummary(row.original, t)}</div>
      ),
    },
    {
      accessorKey: 'channelId',
      header: t('sales.channels.offers.table.channel', 'Channel'),
      cell: ({ row }) => {
        const channelId = row.original.channelId
        if (!channelId) {
          return <span className="text-xs text-muted-foreground">{t('sales.channels.offers.table.channelUnassigned', 'Unassigned')}</span>
        }
        const label = channelOptions.get(channelId)?.label ?? channelId
        const description = channelOptions.get(channelId)?.description ?? null
        return (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{label}</span>
            {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'isActive',
      header: t('sales.channels.offers.table.active', 'Active'),
      cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
    },
    {
      accessorKey: 'updatedAt',
      header: t('sales.channels.offers.table.updated', 'Updated'),
      cell: ({ row }) =>
        row.original.updatedAt
          ? <span className="text-xs text-muted-foreground">{new Date(row.original.updatedAt).toLocaleDateString()}</span>
          : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [channelOptions, t])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'channelIds',
      label: t('sales.channels.offers.filters.channels', 'Sales channels'),
      type: 'tags',
      placeholder: t('sales.channels.offers.filters.channelsPlaceholder', 'Filter by channels…'),
      loadOptions: loadChannelOptions,
      formatValue: (value: string) => channelOptions.get(value)?.label ?? value,
      formatDescription: (value: string) => channelOptions.get(value)?.description ?? null,
    },
  ], [channelOptions, loadChannelOptions, t])

  const loadOffers = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (search.trim().length) {
        params.set('search', search.trim())
      }
      const sort = sorting[0]
      if (sort?.id) {
        params.set('sortField', sort.id)
        params.set('sortDir', sort.desc ? 'desc' : 'asc')
      }
      if (selectedChannelIds.length) {
        params.set('channelIds', selectedChannelIds.join(','))
      }
      const payload = await readApiResultOrThrow<OffersResponse>(
        `/api/catalog/offers?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.channels.offers.errors.load', 'Failed to load offers.') },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      const mapped = items.map(mapOfferRow)
      setRows(mapped)
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : Math.max(1, Math.ceil(items.length / PAGE_SIZE)))
      const ids = mapped
        .map((row) => row.channelId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      if (ids.length) void ensureChannelMetadata(Array.from(new Set(ids)))
    } catch (err) {
      console.error('sales.channels.offers.list', err)
      flash(t('sales.channels.offers.errors.load', 'Failed to load offers.'), 'error')
    } finally {
      setLoading(false)
    }
  }, [ensureChannelMetadata, page, search, selectedChannelIds, sorting, t])

  React.useEffect(() => {
    void loadOffers()
  }, [loadOffers, scopeVersion, reloadToken])

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

  const handleDelete = React.useCallback(async (row: OfferRow) => {
    try {
      await deleteCrud('catalog/offers', row.id, {
        errorMessage: t('sales.channels.offers.errors.delete', 'Failed to delete offer.'),
      })
      flash(t('sales.channels.offers.messages.deleted', 'Offer deleted.'), 'success')
      handleRefresh()
    } catch (err) {
      console.error('sales.channels.offers.delete', err)
    }
  }, [handleRefresh, t])

  const tableTitle = (
    <div className="flex flex-col gap-1">
      <span>{t('sales.channels.offers.listTitle', 'Sales channel offers')}</span>
      <span className="text-sm font-normal text-muted-foreground">
        {t('sales.channels.offers.listSubtitle', 'Review product overrides across every sales channel.')}
      </span>
    </div>
  )

  return (
    <Page>
      <PageBody>
        <DataTable<OfferRow>
          title={tableTitle}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          sorting={sorting}
          onSortingChange={setSorting}
          searchValue={search}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('sales.channels.offers.table.search', 'Search offers…')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          refreshButton={{
            label: t('sales.channels.offers.table.refresh', 'Refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          rowActions={(row) => {
            if (!row.channelId) return null
            return (
              <RowActions
                items={[
                  {
                    id: 'edit',
                    label: t('sales.channels.offers.actions.edit', 'Edit'),
                    href: `/backend/sales/channels/${row.channelId}/offers/${row.id}/edit`,
                  },
                  {
                    id: 'delete',
                    label: t('sales.channels.offers.actions.delete', 'Delete'),
                    onSelect: () => handleDelete(row),
                    destructive: true,
                  },
                ]}
              />
            )
          }}
          onRowClick={(row) => {
            if (!row.channelId) return
            router.push(`/backend/sales/channels/${row.channelId}/offers/${row.id}/edit`)
          }}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('sales.channels.offers.table.emptyAll', 'No offers available yet.')}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}
