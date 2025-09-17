import * as React from 'react'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { Button } from '../primitives/button'
import { Spinner } from '../primitives/spinner'

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
}

export function DataTable<T>({ columns, data, toolbar, title, actions, sortable, sorting: sortingProp, onSortingChange, pagination, isLoading }: DataTableProps<T>) {
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
          {toolbar ? <div className="mt-3 pt-3 border-t">{toolbar}</div> : null}
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
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
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
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
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
