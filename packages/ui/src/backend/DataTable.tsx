"use client"
import * as React from 'react'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { Button } from '../primitives/button'
import { Spinner } from '../primitives/spinner'
import { FilterBar, type FilterDef, type FilterValues } from './FilterBar'
import { fetchCustomFieldFilterDefs } from './utils/customFieldFilters'

export type PaginationProps = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
}

export type DataTableProps<T> = {
  columns: ColumnDef<T, any>[]
  data: T[]
  toolbar?: React.ReactNode
  title?: React.ReactNode
  actions?: React.ReactNode
  sortable?: boolean
  sorting?: SortingState
  onSortingChange?: (s: SortingState) => void
  pagination?: PaginationProps
  isLoading?: boolean
  // Optional per-row actions renderer. When provided, an extra trailing column is rendered.
  rowActions?: (row: T) => React.ReactNode

  // Auto FilterBar options (rendered as toolbar when provided and no custom toolbar passed)
  searchValue?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  searchAlign?: 'left' | 'right'
  filters?: FilterDef[]
  filterValues?: FilterValues
  onFiltersApply?: (values: FilterValues) => void
  onFiltersClear?: () => void
  // When provided, DataTable will fetch custom field definitions and append filter controls for filterable ones.
  entityId?: string
}

export function DataTable<T>({ columns, data, toolbar, title, actions, sortable, sorting: sortingProp, onSortingChange, pagination, isLoading, rowActions, searchValue, onSearchChange, searchPlaceholder, searchAlign = 'right', filters: baseFilters = [], filterValues = {}, onFiltersApply, onFiltersClear, entityId }: DataTableProps<T>) {
  // Map column meta.priority (1..6) to Tailwind responsive visibility
  // 1 => always visible, 2 => hidden <sm, 3 => hidden <md, 4 => hidden <lg, 5 => hidden <xl, 6 => hidden <2xl
  const responsiveClass = (priority?: number) => {
    switch (priority) {
      case 2: return 'hidden sm:table-cell'
      case 3: return 'hidden md:table-cell'
      case 4: return 'hidden lg:table-cell'
      case 5: return 'hidden xl:table-cell'
      case 6: return 'hidden 2xl:table-cell'
      default: return '' // priority 1 or undefined: always visible
    }
  }

  const [sorting, setSorting] = React.useState<SortingState>(sortingProp ?? [])
  const table = useReactTable<T>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(sortable ? { getSortedRowModel: getSortedRowModel() } : {}),
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setSorting(next)
      onSortingChange?.(next)
    },
  })
  React.useEffect(() => { if (sortingProp) setSorting(sortingProp) }, [sortingProp])

  const renderPagination = () => {
    if (!pagination) return null

    const { page, totalPages, onPageChange } = pagination
    const startItem = (page - 1) * pagination.pageSize + 1
    const endItem = Math.min(page * pagination.pageSize, pagination.total)

    return (
      <div className="flex items-center justify-between px-4 py-3 border-t">
        <div className="text-sm text-muted-foreground">
          Showing {startItem} to {endItem} of {pagination.total} results
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    )
  }

  // Auto filters: fetch custom field defs when requested
  const [cfFilters, setCfFilters] = React.useState<FilterDef[]>([])
  const [cfLoadedFor, setCfLoadedFor] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function loadEntity(eid: string) {
      try {
        const f = await fetchCustomFieldFilterDefs(eid)
        if (!cancelled) { setCfFilters(f); setCfLoadedFor(eid) }
      } catch (_) { if (!cancelled) { setCfFilters([]); setCfLoadedFor(eid) } }
    }
    if (entityId && entityId !== cfLoadedFor) loadEntity(entityId)
    return () => { cancelled = true }
  }, [entityId, cfLoadedFor])

  const builtToolbar = React.useMemo(() => {
    if (toolbar) return toolbar
    const anySearch = onSearchChange != null
    const anyFilters = (baseFilters && baseFilters.length > 0) || (cfFilters && cfFilters.length > 0)
    if (!anySearch && !anyFilters) return null
    const combined: FilterDef[] = [...(baseFilters || []), ...(cfFilters || [])]
    return (
      <FilterBar
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        searchAlign={searchAlign}
        filters={combined}
        values={filterValues}
        onApply={onFiltersApply}
        onClear={onFiltersClear}
      />
    )
  }, [toolbar, searchValue, onSearchChange, searchPlaceholder, searchAlign, baseFilters, cfFilters, filterValues, onFiltersApply, onFiltersClear])

  return (
    <div className="rounded-lg border bg-card">
      {(title || actions || toolbar) && (
        <div className="px-4 py-3 border-b">
          {(title || actions) && (
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold leading-tight">
                {typeof title === 'string' ? <h2 className="text-base font-semibold">{title}</h2> : title}
              </div>
              <div className="flex items-center gap-2">{actions}</div>
            </div>
          )}
          {builtToolbar ? <div className="mt-3 pt-3 border-t">{builtToolbar}</div> : null}
        </div>
      )}
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id} className={responsiveClass((header.column.columnDef as any)?.meta?.priority)}>
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 ${sortable && header.column.getCanSort?.() ? 'cursor-pointer select-none' : ''}`}
                        onClick={() => sortable && header.column.toggleSorting?.(header.column.getIsSorted() === 'asc')}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortable && header.column.getIsSorted?.() ? (
                          <span className="text-xs text-muted-foreground">{header.column.getIsSorted() === 'asc' ? '▲' : '▼'}</span>
                        ) : null}
                      </button>
                    )}
                  </TableHead>
                ))}
                {rowActions ? (
                  <TableHead className="w-0 text-right">
                    Actions
                  </TableHead>
                ) : null}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="h-24 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Spinner size="md" />
                    <span className="text-muted-foreground">Loading data...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={responsiveClass((cell.column.columnDef as any)?.meta?.priority)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                  {rowActions ? (
                    <TableCell className="text-right whitespace-nowrap">
                      {rowActions(row.original as T)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {renderPagination()}
    </div>
  )
}
