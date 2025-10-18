"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState, type Column as TableColumn } from '@tanstack/react-table'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { Button } from '../primitives/button'
import { Spinner } from '../primitives/spinner'
import { FilterBar, type FilterDef, type FilterValues } from './FilterBar'
import { fetchCustomFieldFilterDefs } from './utils/customFieldFilters'
import { type RowActionItem } from './RowActions'
import { subscribeOrganizationScopeChanged } from '@/lib/frontend/organizationEvents'

let refreshScheduled = false
function scheduleRouterRefresh(router: ReturnType<typeof useRouter>) {
  if (refreshScheduled) return
  refreshScheduled = true
  if (typeof window === 'undefined') {
    refreshScheduled = false
    return
  }
  window.requestAnimationFrame(() => {
    refreshScheduled = false
    try { router.refresh() } catch {}
  })
}

export type PaginationProps = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
}

export type DataTableRefreshButton = {
  onRefresh: () => void
  label: string
  isRefreshing?: boolean
  disabled?: boolean
}

// Helper function to extract edit action from RowActions items
function extractEditAction(items: RowActionItem[]): RowActionItem | null {
  return items.find(item => 
    item.label.toLowerCase() === 'edit' && 
    (item.href || item.onSelect)
  ) || null
}

export type DataTableExportFormat = 'csv' | 'json' | 'xml' | 'markdown'

export type DataTableExportConfig = {
  getUrl: (format: DataTableExportFormat) => string
  formats?: DataTableExportFormat[]
  label?: string
  disabled?: boolean
}

export type DataTableProps<T> = {
  columns: ColumnDef<T, any>[]
  data: T[]
  toolbar?: React.ReactNode
  title?: React.ReactNode
  actions?: React.ReactNode
  refreshButton?: DataTableRefreshButton
  sortable?: boolean
  sorting?: SortingState
  onSortingChange?: (s: SortingState) => void
  pagination?: PaginationProps
  isLoading?: boolean
  // Optional per-row actions renderer. When provided, an extra trailing column is rendered.
  rowActions?: (row: T) => React.ReactNode
  // Optional row click handler. When provided, rows become clickable and show pointer cursor.
  // If not provided but rowActions contains an 'Edit' action, it will be used as the default row click handler.
  onRowClick?: (row: T) => void

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
  exporter?: DataTableExportConfig | false
}

const DEFAULT_EXPORT_FORMATS: DataTableExportFormat[] = ['csv', 'json', 'xml', 'markdown']
const EXPORT_LABELS: Record<DataTableExportFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  xml: 'XML',
  markdown: 'Markdown',
}

function ExportMenu({ config }: { config: DataTableExportConfig }) {
  const { formats = DEFAULT_EXPORT_FORMATS, getUrl, label = 'Export', disabled } = config
  const formatList = React.useMemo(() => {
    const seen = new Set<DataTableExportFormat>()
    return formats.filter((format) => {
      if (seen.has(format)) return false
      seen.add(format)
      return true
    })
  }, [formats])
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current && !menuRef.current.contains(target) && buttonRef.current && !buttonRef.current.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSelect = (format: DataTableExportFormat) => {
    try {
      const url = getUrl(format)
      if (url && typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      // ignore malformed urls
    } finally {
      setOpen(false)
    }
  }

  return (
    <div className="relative inline-block">
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
      >
        {label}
      </Button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 mt-2 w-40 rounded-md border bg-background p-1 shadow z-20"
        >
          {formatList.map((format) => (
            <button
              key={format}
              type="button"
              className="block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent"
              onClick={() => handleSelect(format)}
            >
              {EXPORT_LABELS[format]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function DataTable<T>({ columns, data, toolbar, title, actions, refreshButton, sortable, sorting: sortingProp, onSortingChange, pagination, isLoading, rowActions, onRowClick, searchValue, onSearchChange, searchPlaceholder, searchAlign = 'right', filters: baseFilters = [], filterValues = {}, onFiltersApply, onFiltersClear, entityId, exporter }: DataTableProps<T>) {
  const router = useRouter()
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged(() => scheduleRouterRefresh(router))
  }, [router])
  // Date formatting setup
  const DATE_FORMAT = (process.env.NEXT_PUBLIC_DATE_FORMAT || 'YYYY-MM-DD HH:mm') as string

  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n))
  const simpleFormat = (d: Date, fmt: string) => {
    // Supports tokens: YYYY, MM, DD, HH, mm, ss
    const YYYY = String(d.getFullYear())
    const MM = pad2(d.getMonth() + 1)
    const DD = pad2(d.getDate())
    const HH = pad2(d.getHours())
    const mm = pad2(d.getMinutes())
    const ss = pad2(d.getSeconds())
    return fmt
      .replace(/YYYY/g, YYYY)
      .replace(/MM/g, MM)
      .replace(/DD/g, DD)
      .replace(/HH/g, HH)
      .replace(/mm/g, mm)
      .replace(/ss/g, ss)
  }

  const tryParseDate = (v: unknown): Date | null => {
    if (v == null) return null
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v
    if (typeof v === 'number') {
      const d = new Date(v)
      return isNaN(d.getTime()) ? null : d
    }
    if (typeof v === 'string') {
      const s = v.trim()
      if (!s) return null
      // ISO-like detection (YYYY-MM-DD ...)
      if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
        const d = new Date(s)
        return isNaN(d.getTime()) ? null : d
      }
      // Fallback: Date.parse
      const d = new Date(s)
      return isNaN(d.getTime()) ? null : d
    }
    return null
  }

  // Guess date columns once using first non-empty row
  const [dateColumnIds, setDateColumnIds] = React.useState<Set<string> | null>(null)
  React.useEffect(() => {
    if (dateColumnIds) return
    if (!data || data.length === 0) return
    // Build a cheap row accessor using column defs
    const accessors = columns.map((c) => {
      const key = (c as any).accessorKey as string | undefined
      const id = (c as any).id as string | undefined
      return { id: id || key || '', key }
    })
    const guessed = new Set<string>()
    accessors.forEach((a) => {
      if (!a.id) return
      const name = a.id
      // Name-based guess: snake_case '_at' suffix
      if (name.endsWith('_at')) {
        guessed.add(name)
        return
      }
    })
    setDateColumnIds(guessed)
  }, [dateColumnIds, data, columns])
  // Map column meta.priority (1..6) to Tailwind responsive visibility
  // 1 => always visible, 2 => hidden <sm, 3 => hidden <md, 4 => hidden <lg, 5 => hidden <xl, 6 => hidden <2xl
  const responsiveClass = (priority?: number, hidden?: boolean) => {
    if (hidden) return 'hidden'
    switch (priority) {
      case 2: return 'hidden sm:table-cell'
      case 3: return 'hidden md:table-cell'
      case 4: return 'hidden lg:table-cell'
      case 5: return 'hidden xl:table-cell'
      case 6: return 'hidden 2xl:table-cell'
      default: return '' // priority 1 or undefined: always visible
    }
  }

  const resolvePriority = React.useCallback((column: TableColumn<T, unknown>) => {
    const meta = (column.columnDef as any)?.meta
    const rawPriority = typeof meta?.priority === 'number' ? meta.priority : undefined
    if (rawPriority && rawPriority > 0) return rawPriority
    const index = column.getIndex()
    return index <= 1 ? 1 : 2
  }, [])

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
    // Merge base filters with CF filters, preferring base definitions when ids collide
    const baseList = baseFilters || []
    const existing = new Set(baseList.map((f) => f.id))
    const cfOnly = (cfFilters || []).filter((f) => !existing.has(f.id))
    const combined: FilterDef[] = [...baseList, ...cfOnly]
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

  const hasTitle = title != null
  const hasActions = actions !== undefined && actions !== null && actions !== false
  const shouldReserveActionsSpace = actions === null || actions === false
  const exportConfig = exporter === false ? null : exporter || null
  const hasExport = Boolean(exportConfig)
  const refreshButtonConfig = refreshButton
  const hasRefreshButton = Boolean(refreshButtonConfig)
  const hasToolbar = builtToolbar != null
  const shouldRenderActionsWrapper = hasActions || hasRefreshButton || shouldReserveActionsSpace || hasExport
  const shouldRenderHeader = hasTitle || hasToolbar || shouldRenderActionsWrapper

  return (
    <div className="rounded-lg border bg-card">
      {shouldRenderHeader && (
        <div className="px-4 py-3 border-b">
          {(hasTitle || shouldRenderActionsWrapper) && (
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold leading-tight min-h-[2.25rem] flex items-center">
                {hasTitle ? (typeof title === 'string' ? <h2 className="text-base font-semibold">{title}</h2> : title) : null}
              </div>
              {shouldRenderActionsWrapper ? (
                <div className="flex items-center gap-2 min-h-[2.25rem]">
                  {refreshButtonConfig ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={refreshButtonConfig.onRefresh}
                      aria-label={refreshButtonConfig.label}
                      title={refreshButtonConfig.label}
                      disabled={refreshButtonConfig.disabled || refreshButtonConfig.isRefreshing}
                    >
                      {refreshButtonConfig.isRefreshing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="sr-only">{refreshButtonConfig.label}</span>
                    </Button>
                  ) : null}
                  {exportConfig ? <ExportMenu config={exportConfig} /> : null}
                  {hasActions ? actions : null}
                </div>
              ) : null}
            </div>
          )}
          {hasToolbar ? <div className="mt-3 pt-3 border-t">{builtToolbar}</div> : null}
        </div>
      )}
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const columnMeta = (header.column.columnDef as any)?.meta
                  const priority = resolvePriority(header.column)
                  return (
                    <TableHead key={header.id} className={responsiveClass(priority, columnMeta?.hidden)}>
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
                  )
                })}
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
              table.getRowModel().rows.map((row) => {
                const isClickable = onRowClick || (rowActions && rowActions(row.original as T))
                
                return (
                  <TableRow 
                    key={row.id} 
                    data-state={row.getIsSelected() && 'selected'}
                    className={isClickable ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}
                    onClick={isClickable ? (e) => {
                      // Don't trigger row click if clicking on actions cell
                      if ((e.target as HTMLElement).closest('[data-actions-cell]')) {
                        return
                      }
                      
                      if (onRowClick) {
                        onRowClick(row.original as T)
                      } else if (rowActions) {
                        // Auto-extract and execute edit action
                        const rowActionsElement = rowActions(row.original as T)
                        if (React.isValidElement(rowActionsElement) && 
                            'items' in (rowActionsElement.props as any) && 
                            Array.isArray((rowActionsElement.props as any).items)) {
                          const editAction = extractEditAction((rowActionsElement.props as any).items as RowActionItem[])
                          if (editAction) {
                            if (editAction.href) {
                              router.push(editAction.href)
                            } else if (editAction.onSelect) {
                              editAction.onSelect()
                            }
                          }
                        }
                      }
                    } : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const columnMeta = (cell.column.columnDef as any)?.meta
                      const priority = resolvePriority(cell.column)
                      const hasCustomCell = Boolean(cell.column.columnDef.cell)
                      const columnId = String((cell.column as any).id || '')
                      const isDateCol = dateColumnIds ? dateColumnIds.has(columnId) : false

                      let content: React.ReactNode
                      if (isDateCol) {
                        const raw = cell.getValue() as any
                        const d = tryParseDate(raw)
                        content = d ? simpleFormat(d, DATE_FORMAT) : (raw as any)
                      } else {
                        content = flexRender(cell.column.columnDef.cell, cell.getContext())
                      }

                      return (
                        <TableCell key={cell.id} className={responsiveClass(priority, columnMeta?.hidden)}>
                          {content}
                        </TableCell>
                      )
                    })}
                    {rowActions ? (
                      <TableCell className="text-right whitespace-nowrap" data-actions-cell>
                        {rowActions(row.original as T)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })
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
