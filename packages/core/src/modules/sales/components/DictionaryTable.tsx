"use client"

import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { DataTable, type DataTableExportConfig } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { DataTableRefreshButton } from '@open-mercato/ui/backend/DataTable'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList, type ListResponse } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

export type DictionaryTableQueryParams = {
  page: number
  pageSize: number
  search: string
  sorting: SortingState
  filters: FilterValues
}

export type DictionaryTableProps<TItem extends Record<string, unknown>> = {
  apiPath: string
  columns: ColumnDef<TItem, any>[]
  title?: React.ReactNode
  toolbar?: React.ReactNode
  actions?: React.ReactNode
  defaultPageSize?: number
  searchPlaceholderKey?: string
  searchAlign?: 'left' | 'right'
  filterDefs?: FilterDef[]
  buildQuery?: (params: DictionaryTableQueryParams) => Record<string, unknown>
  exporter?: DataTableExportConfig | false
  customFieldEntityIds?: string | string[]
  rowActions?: (item: TItem) => React.ReactNode
  onRowClick?: (item: TItem) => void
  initialSort?: { field: string; dir?: 'asc' | 'desc' }
  refreshKey?: unknown
}

const EMPTY_FILTERS: FilterValues = Object.freeze({}) as FilterValues

export function DictionaryTable<TItem extends Record<string, unknown>>({
  apiPath,
  columns,
  title,
  toolbar,
  actions,
  defaultPageSize = 25,
  searchPlaceholderKey = 'sales.configuration.table.search',
  searchAlign = 'right',
  filterDefs,
  buildQuery,
  exporter,
  customFieldEntityIds,
  rowActions,
  onRowClick,
  initialSort,
  refreshKey,
}: DictionaryTableProps<TItem>): JSX.Element {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(defaultPageSize)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>(EMPTY_FILTERS)
  const [sorting, setSorting] = React.useState<SortingState>(
    initialSort
      ? [{ id: initialSort.field, desc: initialSort.dir ? initialSort.dir === 'desc' : false }]
      : []
  )

  const queryParams = React.useMemo(() => {
    const params: DictionaryTableQueryParams = {
      page,
      pageSize,
      search,
      sorting,
      filters,
    }

    const primarySort = sorting[0]
    const base: Record<string, unknown> = {
      page,
      pageSize,
    }
    if (search.trim().length > 0) base.search = search.trim()
    if (primarySort && primarySort.id) {
      base.sortField = primarySort.id
      base.sortDir = primarySort.desc ? 'desc' : 'asc'
    }

    const filterPayload: Record<string, unknown> = {}
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      if (typeof value === 'string' && value.trim().length === 0) return
      filterPayload[key] = value
    })

    const custom = buildQuery ? buildQuery(params) : {}
    return {
      ...base,
      ...filterPayload,
      ...custom,
    }
  }, [page, pageSize, search, sorting, filters, buildQuery])

  const serializedParams = React.useMemo(() => JSON.stringify(queryParams), [queryParams])

  const queryKey = React.useMemo(
    () => ['sales-dictionary-table', apiPath, serializedParams, scopeVersion, refreshKey],
    [apiPath, serializedParams, scopeVersion, refreshKey]
  )

  const { data, isLoading, isFetching, error, refetch } = useQuery<ListResponse<TItem>>({
    queryKey,
    queryFn: async () => {
      try {
        return await fetchCrudList<TItem>(apiPath, queryParams)
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.configuration.errors.load_failed', 'Failed to load records.')
        throw new Error(message)
      }
    },
    keepPreviousData: true,
  })

  React.useEffect(() => {
    if (!error) return
    const message =
      error instanceof Error && error.message
        ? error.message
        : t('sales.configuration.errors.load_failed', 'Failed to load records.')
    flash(message, 'error')
  }, [error, t])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil(total / pageSize))

  const refreshButton = React.useMemo<DataTableRefreshButton>(
    () => ({
      onRefresh: () => refetch(),
      label: t('sales.configuration.table.refresh', 'Refresh'),
      isRefreshing: isFetching,
    }),
    [refetch, isFetching, t]
  )

  const handleSearchChange = React.useCallback(
    (value: string) => {
      setSearch(value)
      setPage(1)
    },
    []
  )

  const handleFiltersApply = React.useCallback((next: FilterValues) => {
    setFilters({ ...(next || {}) })
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilters({})
    setPage(1)
  }, [])

  const entityIds = React.useMemo(() => {
    if (!customFieldEntityIds) return undefined
    return Array.isArray(customFieldEntityIds) ? customFieldEntityIds : [customFieldEntityIds]
  }, [customFieldEntityIds])

  return (
    <DataTable<TItem>
      columns={columns}
      data={items}
      title={title}
      toolbar={toolbar}
      actions={actions}
      refreshButton={refreshButton}
      pagination={{
        page,
        pageSize,
        total,
        totalPages,
        onPageChange: setPage,
      }}
      isLoading={isLoading && !data}
      sorting={sorting}
      onSortingChange={setSorting}
      searchValue={search}
      onSearchChange={handleSearchChange}
      searchPlaceholder={t(searchPlaceholderKey, 'Search records')}
      searchAlign={searchAlign}
      filters={filterDefs}
      filterValues={filters}
      onFiltersApply={handleFiltersApply}
      onFiltersClear={handleFiltersClear}
      exporter={exporter ?? false}
      entityIds={entityIds}
      rowActions={rowActions}
      onRowClick={onRowClick}
    />
  )
}
