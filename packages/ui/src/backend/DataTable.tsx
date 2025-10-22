"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState, type Column as TableColumn, type VisibilityState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Loader2, SlidersHorizontal, MoreHorizontal } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { Button } from '../primitives/button'
import { Spinner } from '../primitives/spinner'
import { FilterBar, type FilterDef, type FilterValues } from './FilterBar'
import { useCustomFieldFilterDefs } from './utils/customFieldFilters'
import { type RowActionItem } from './RowActions'
import { subscribeOrganizationScopeChanged } from '@/lib/frontend/organizationEvents'
import { serializeExport, defaultExportFilename, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { apiFetch } from './utils/api'
import { PerspectiveSidebar } from './PerspectiveSidebar'
import type {
  PerspectiveDto,
  RolePerspectiveDto,
  PerspectivesIndexResponse,
  PerspectiveSettings,
  PerspectiveSaveResponse,
} from '@open-mercato/shared/modules/perspectives/types'

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

export type DataTableExportSectionConfig = {
  title?: string
  description?: string
  getUrl?: (format: DataTableExportFormat) => string
  prepare?: (format: DataTableExportFormat) => Promise<PreparedExport | { prepared: PreparedExport; filename?: string } | null> | PreparedExport | { prepared: PreparedExport; filename?: string } | null
  formats?: DataTableExportFormat[]
  disabled?: boolean
  filename?: (format: DataTableExportFormat) => string
}

export type DataTableExportConfig = {
  label?: string
  disabled?: boolean
  formats?: DataTableExportFormat[]
  getUrl?: (format: DataTableExportFormat) => string
  sections?: DataTableExportSectionConfig[]
  view?: DataTableExportSectionConfig
  full?: DataTableExportSectionConfig
  filename?: (format: DataTableExportFormat) => string
}

export type DataTablePerspectiveConfig = {
  tableId: string
  initialState?: {
    response?: PerspectivesIndexResponse
    activePerspectiveId?: string | null
  }
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
  entityIds?: string[]
  exporter?: DataTableExportConfig | false
  perspective?: DataTablePerspectiveConfig
}

const DEFAULT_EXPORT_FORMATS: DataTableExportFormat[] = ['csv', 'json', 'xml', 'markdown']
const EXPORT_LABELS: Record<DataTableExportFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  xml: 'XML',
  markdown: 'Markdown',
}
const EMPTY_FILTER_DEFS: FilterDef[] = Object.freeze([]) as FilterDef[]
const EMPTY_FILTER_VALUES: FilterValues = Object.freeze({}) as FilterValues

type ResolvedExportSection = {
  key: string
  title: string
  description?: string
  formats: DataTableExportFormat[]
  getUrl?: (format: DataTableExportFormat) => string
  prepare?: (format: DataTableExportFormat) => Promise<{ prepared: PreparedExport; filename?: string } | null> | { prepared: PreparedExport; filename?: string } | null
  filename?: (format: DataTableExportFormat) => string
  disabled: boolean
}

function resolveExportSections(config: DataTableExportConfig | null | undefined): ResolvedExportSection[] {
  if (!config) return []
  const sections: ResolvedExportSection[] = []
  const baseFormats = config.formats && config.formats.length > 0 ? config.formats : DEFAULT_EXPORT_FORMATS
  const addSection = (key: string, section: DataTableExportSectionConfig | undefined | null, fallbackTitle: string) => {
    if (!section || (!section.getUrl && !section.prepare)) return
    const title = section.title?.trim().length ? section.title!.trim() : fallbackTitle
    const seen = new Set<DataTableExportFormat>()
    const formatsSource = section.formats && section.formats.length > 0 ? section.formats : baseFormats
    const formats = formatsSource.filter((format) => {
      if (seen.has(format)) return false
      seen.add(format)
      return true
    })
    if (formats.length === 0) return
    sections.push({
      key,
      title,
      description: section.description,
      formats,
      getUrl: section.getUrl,
      prepare: section.prepare
        ? async (format: DataTableExportFormat) => {
            const result = await section.prepare!(format)
            if (!result) return null
            if ('prepared' in result) return result
            return { prepared: result }
          }
        : undefined,
      filename: section.filename,
      disabled: Boolean(config.disabled || section.disabled),
    })
  }

  // Allow legacy config (getUrl without sections/view)
  const hasExplicitSections = Array.isArray(config.sections) && config.sections.length > 0
  if (!config.view && !config.full && !hasExplicitSections && config.getUrl) {
    addSection('view', { getUrl: config.getUrl, formats: config.formats }, 'Export what you view')
  } else {
    addSection('view', config.view, 'Export what you view')
  }

  if (hasExplicitSections) {
    config.sections!.forEach((section, idx) => {
      addSection(`section-${idx}`, section, section.title?.trim().length ? section.title! : `Export ${idx + 1}`)
    })
  }

  addSection('full', config.full, 'Full data export')
  return sections
}

const PERSPECTIVE_COOKIE_PREFIX = 'om_table_perspective'

function readPerspectiveCookie(tableId: string): string | null {
  if (typeof document === 'undefined') return null
  const key = `${PERSPECTIVE_COOKIE_PREFIX}:${tableId}`
  const pattern = new RegExp(`(?:^|;\\s*)${key}=([^;]+)`)
  const match = document.cookie.match(pattern)
  return match ? decodeURIComponent(match[1]) : null
}

function writePerspectiveCookie(tableId: string, perspectiveId: string | null): void {
  if (typeof document === 'undefined') return
  const key = `${PERSPECTIVE_COOKIE_PREFIX}:${tableId}`
  const expires = perspectiveId ? 'Max-Age=31536000' : 'Max-Age=0'
  const value = perspectiveId ? encodeURIComponent(perspectiveId) : ''
  document.cookie = `${key}=${value}; Path=/; ${expires}; SameSite=Lax`
}

function normalizeLabel(input: string): string {
  if (!input) return ''
  return input
    .replace(/^cf[_:]/, '')
    .replace(/[_:\-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function ExportMenu({ config, sections }: { config: DataTableExportConfig; sections: ResolvedExportSection[] }) {
  if (!sections.length) return null
  const { label = 'Export' } = config
  const disabled = Boolean(config.disabled)
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

  const handleSelect = async (section: ResolvedExportSection, format: DataTableExportFormat) => {
    try {
      if (section.prepare) {
        const preparedResult = await section.prepare(format)
        if (!preparedResult) return
        const prepared = preparedResult.prepared
        const serialized = serializeExport(prepared, format)
        const filename =
          preparedResult.filename
          ?? section.filename?.(format)
          ?? config.filename?.(format)
          ?? defaultExportFilename(section.title, format)
        if (typeof window !== 'undefined') {
          const blob = new Blob([serialized.body], { type: serialized.contentType })
          const href = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = href
          a.download = filename
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(href)
        }
      } else if (section.getUrl) {
        const url = section.getUrl(format)
        if (url && typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      }
    } catch {
      // ignore export errors
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
          className="absolute right-0 mt-2 w-60 rounded-md border bg-background py-2 shadow z-20"
        >
          {sections.map((section, idx) => (
            <div key={section.key} className={idx > 0 ? 'mt-2 border-t pt-3' : ''}>
              <div className="px-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">{section.title}</div>
                {section.description ? (
                  <p className="mt-1 text-xs text-muted-foreground leading-snug">{section.description}</p>
                ) : null}
              </div>
              <div className="mt-2 space-y-1 px-2 pb-1">
                {section.formats.map((format) => (
                  <button
                    key={`${section.key}-${format}`}
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                    onClick={() => void handleSelect(section, format)}
                    disabled={section.disabled}
                  >
                    {EXPORT_LABELS[format]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function DataTable<T>({
  columns,
  data,
  toolbar,
  title,
  actions,
  refreshButton,
  sortable,
  sorting: sortingProp,
  onSortingChange,
  pagination,
  isLoading,
  rowActions,
  onRowClick,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAlign = 'right',
  filters: baseFilters = EMPTY_FILTER_DEFS,
  filterValues = EMPTY_FILTER_VALUES,
  onFiltersApply,
  onFiltersClear,
  entityId,
  entityIds,
  exporter,
  perspective,
}: DataTableProps<T>) {
  const router = useRouter()
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged(() => scheduleRouterRefresh(router))
  }, [router])
  const queryClient = useQueryClient()
  const perspectiveConfig = perspective ?? null
  const perspectiveTableId = perspectiveConfig?.tableId ?? null
  const perspectiveEnabled = Boolean(perspectiveTableId)
  const [isPerspectiveOpen, setPerspectiveOpen] = React.useState(false)
  const [activePerspectiveId, setActivePerspectiveId] = React.useState<string | null>(perspectiveConfig?.initialState?.activePerspectiveId ?? null)
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [columnOrder, setColumnOrder] = React.useState<string[]>([])
  const [deletingIds, setDeletingIds] = React.useState<string[]>([])
  const [roleClearingIds, setRoleClearingIds] = React.useState<string[]>([])
  const [perspectiveApiMissing, setPerspectiveApiMissing] = React.useState(false)

  const perspectiveQuery = useQuery<PerspectivesIndexResponse>({
    queryKey: ['table-perspectives', perspectiveTableId],
    queryFn: async () => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const res = await apiFetch(`/api/perspectives/${encodeURIComponent(perspectiveTableId)}`)
      if (res.status === 404) {
        setPerspectiveApiMissing(true)
        return {
          tableId: perspectiveTableId,
          perspectives: [],
          defaultPerspectiveId: null,
          rolePerspectives: [],
          roles: [],
          canApplyToRoles: false,
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const error = body?.error ?? 'Failed to load perspectives'
        throw new Error(error)
      }
      setPerspectiveApiMissing(false)
      return await res.json() as PerspectivesIndexResponse
    },
    enabled: perspectiveEnabled,
    initialData: perspectiveConfig?.initialState?.response,
  })
  const perspectiveData = perspectiveQuery.data
  const initialPerspectiveAppliedRef = React.useRef(false)

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
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setSorting(next)
      onSortingChange?.(next)
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater
      setColumnVisibility(next)
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnOrder) : updater
      setColumnOrder(next)
    },
  })
  React.useEffect(() => { if (sortingProp) setSorting(sortingProp) }, [sortingProp])
  React.useEffect(() => {
    if (columnOrder.length > 0) return
    const ids = table.getAllLeafColumns().map((column) => column.id)
    if (ids.length) setColumnOrder(ids)
  }, [table, columnOrder.length])

  const initialVisibilityApplied = React.useRef(false)
  React.useEffect(() => {
    if (initialVisibilityApplied.current) return
    const hidden: VisibilityState = {}
    table.getAllLeafColumns().forEach((column) => {
      const hiddenMeta = (column.columnDef as any)?.meta?.hidden
      if (hiddenMeta) hidden[column.id] = false
    })
    if (Object.keys(hidden).length) {
      setColumnVisibility((prev) => ({ ...hidden, ...prev }))
    }
    initialVisibilityApplied.current = true
  }, [table])

  const getCurrentSettings = React.useCallback((): PerspectiveSettings => {
    const settings: PerspectiveSettings = {}
    if (columnOrder.length) settings.columnOrder = [...columnOrder]
    if (Object.keys(columnVisibility).length) settings.columnVisibility = { ...columnVisibility }
    if (sorting.length) settings.sorting = sorting.map((item) => ({ ...item }))
    settings.filters = { ...(filterValues ?? {}) }
    settings.searchValue = searchValue ?? ''
    return settings
  }, [columnOrder, columnVisibility, sorting, filterValues, searchValue])

  const applyPerspectiveSettings = React.useCallback((settings: PerspectiveSettings, nextId: string | null) => {
    if (settings.columnOrder && settings.columnOrder.length) {
      setColumnOrder(settings.columnOrder)
    } else {
      const ids = table.getAllLeafColumns().map((column) => column.id)
      if (ids.length) setColumnOrder(ids)
    }
    if (settings.columnVisibility) setColumnVisibility(settings.columnVisibility)
    else setColumnVisibility({})
    if (settings.sorting) {
      setSorting(settings.sorting)
      onSortingChange?.(settings.sorting)
    }
    if (onFiltersApply) {
      onFiltersApply((settings.filters ?? {}) as FilterValues)
    }
    if (onSearchChange && settings.searchValue !== undefined) {
      onSearchChange(settings.searchValue ?? '')
    }
    setActivePerspectiveId(nextId)
    if (perspectiveTableId) writePerspectiveCookie(perspectiveTableId, nextId)
  }, [onFiltersApply, onSearchChange, onSortingChange, perspectiveTableId, table])

  type SavePerspectivePayload = {
    name: string
    isDefault: boolean
    applyToRoles: string[]
    setRoleDefault: boolean
    perspectiveId?: string | null
  }

  const perspectiveQueryKey: [string, string | null] = ['table-perspectives', perspectiveTableId]
  const savePerspectiveMutation = useMutation<PerspectiveSaveResponse, Error, SavePerspectivePayload>({
    mutationFn: async (input) => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const payload = {
        perspectiveId: input.perspectiveId ?? undefined,
        name: input.name,
        settings: getCurrentSettings(),
        isDefault: input.isDefault,
        applyToRoles: input.applyToRoles,
        setRoleDefault: input.setRoleDefault,
      }
      const res = await apiFetch(`/api/perspectives/${encodeURIComponent(perspectiveTableId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 404) {
        throw new Error('Perspectives API is not available. Run `npm run modules:prepare` to regenerate module routes and restart the dev server.')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const error = body?.error ?? 'Failed to save perspective'
        throw new Error(error)
      }
      return await res.json() as PerspectiveSaveResponse
    },
    onSuccess: (data) => {
      if (perspectiveTableId) {
        void queryClient.invalidateQueries({ queryKey: perspectiveQueryKey })
      }
      if (data.perspective) {
        applyPerspectiveSettings(data.perspective.settings, data.perspective.id)
      }
    },
  })

  const resolveColumnLabel = React.useCallback((column: TableColumn<T, unknown>): string => {
    const meta = (column.columnDef as any)?.meta
    if (typeof meta?.label === 'string' && meta.label.trim().length > 0) return meta.label.trim()
    if (typeof meta?.title === 'string' && meta.title.trim().length > 0) return meta.title.trim()
    const header = column.columnDef.header
    if (typeof header === 'string') return header
    if (typeof header === 'function') {
      try {
        const result = header(column.getContext())
        if (typeof result === 'string') return result
      } catch {
        // ignore header rendering errors
      }
    }
    return normalizeLabel(column.id)
  }, [])

  const columnOptions = React.useMemo(() => {
    const leaves = table.getAllLeafColumns()
    const baseOrder = columnOrder.length ? columnOrder : leaves.map((column) => column.id)
    const seen = new Set<string>()
    const ordered = baseOrder
      .map((id) => {
        const col = leaves.find((column) => column.id === id)
        if (!col) return null
        seen.add(id)
        return col
      })
      .filter(Boolean) as Array<TableColumn<T, unknown>>
    leaves.forEach((column) => { if (!seen.has(column.id)) ordered.push(column) })
    return ordered.map((column) => ({
      id: column.id,
      label: resolveColumnLabel(column),
      visible: columnVisibility[column.id] ?? column.getIsVisible(),
      canHide: column.getCanHide(),
    }))
  }, [table, columnOrder, resolveColumnLabel, columnVisibility])

  const activePersonalPerspectiveId = React.useMemo(() => {
    if (!perspectiveData || !activePerspectiveId) return null
    const found = perspectiveData.perspectives.find((p) => p.id === activePerspectiveId)
    return found ? found.id : null
  }, [perspectiveData, activePerspectiveId])


  const deletePerspectiveMutation = useMutation<void, Error, { perspectiveId: string }>({
    mutationFn: async ({ perspectiveId }) => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const res = await apiFetch(`/api/perspectives/${encodeURIComponent(perspectiveTableId)}/${encodeURIComponent(perspectiveId)}`, {
        method: 'DELETE',
      })
      if (res.status === 404) throw new Error('Perspectives API is not available. Run `npm run modules:prepare` and restart the dev server.')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const error = body?.error ?? 'Failed to delete perspective'
        throw new Error(error)
      }
    },
    onMutate: ({ perspectiveId }) => {
      setDeletingIds((prev) => prev.includes(perspectiveId) ? prev : [...prev, perspectiveId])
    },
    onSettled: (_data, _error, variables) => {
      setDeletingIds((prev) => prev.filter((id) => id !== variables.perspectiveId))
    },
    onSuccess: (_data, variables) => {
      const removedActive = activePerspectiveId === variables.perspectiveId
      if (perspectiveTableId) {
        void queryClient.invalidateQueries({ queryKey: perspectiveQueryKey })
        if (removedActive) {
          setActivePerspectiveId(null)
          writePerspectiveCookie(perspectiveTableId, null)
          initialPerspectiveAppliedRef.current = false
        }
      } else if (removedActive) {
        setActivePerspectiveId(null)
        initialPerspectiveAppliedRef.current = false
      }
    },
  })

  const clearRoleMutation = useMutation<void, Error, { roleId: string }>({
    mutationFn: async ({ roleId }) => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const res = await apiFetch(`/api/perspectives/${encodeURIComponent(perspectiveTableId)}/roles/${encodeURIComponent(roleId)}`, {
        method: 'DELETE',
      })
      if (res.status === 404) throw new Error('Perspectives API is not available. Run `npm run modules:prepare` and restart the dev server.')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const error = body?.error ?? 'Failed to clear role perspectives'
        throw new Error(error)
      }
    },
    onMutate: ({ roleId }) => {
      setRoleClearingIds((prev) => prev.includes(roleId) ? prev : [...prev, roleId])
    },
    onSettled: (_data, _error, variables) => {
      setRoleClearingIds((prev) => prev.filter((id) => id !== variables.roleId))
    },
    onSuccess: (_data, variables) => {
      if (perspectiveTableId) {
        void queryClient.invalidateQueries({ queryKey: perspectiveQueryKey })
      }
      if (activePerspectiveId) {
        const current = queryClient.getQueryData<PerspectivesIndexResponse>(perspectiveQueryKey)
        const match = current?.rolePerspectives.find((rp) => rp.id === activePerspectiveId)
        if (match && match.roleId === variables.roleId) {
          setActivePerspectiveId(null)
          if (perspectiveTableId) writePerspectiveCookie(perspectiveTableId, null)
          initialPerspectiveAppliedRef.current = false
        }
      }
    },
  })

  const handlePerspectiveActivate = React.useCallback((item: PerspectiveDto | RolePerspectiveDto, _source?: 'personal' | 'role') => {
    applyPerspectiveSettings(item.settings, item.id)
    setPerspectiveOpen(false)
  }, [applyPerspectiveSettings])

  const handlePerspectiveSave = React.useCallback(async (input: { name: string; isDefault: boolean; applyToRoles: string[]; setRoleDefault: boolean }) => {
    const normalizedRoles = Array.from(new Set(input.applyToRoles))
    await savePerspectiveMutation.mutateAsync({
      name: input.name.trim(),
      isDefault: input.isDefault,
      applyToRoles: normalizedRoles,
      setRoleDefault: normalizedRoles.length > 0 ? input.setRoleDefault : false,
      perspectiveId: activePersonalPerspectiveId,
    })
  }, [savePerspectiveMutation, activePersonalPerspectiveId])

  const handlePerspectiveDelete = React.useCallback(async (perspectiveId: string) => {
    await deletePerspectiveMutation.mutateAsync({ perspectiveId })
  }, [deletePerspectiveMutation])

  const handleClearRole = React.useCallback(async (roleId: string) => {
    await clearRoleMutation.mutateAsync({ roleId })
  }, [clearRoleMutation])

  const handleToggleColumn = React.useCallback((columnId: string, visible: boolean) => {
    const column = table.getColumn(columnId)
    if (!column) return
    setColumnVisibility((prev) => {
      const next = { ...prev }
      if (visible) delete next[columnId]
      else next[columnId] = false
      return next
    })
    column.toggleVisibility(visible)
  }, [table])

  const handleMoveColumn = React.useCallback((columnId: string, direction: 'up' | 'down') => {
    setColumnOrder((prev) => {
      const idx = prev.indexOf(columnId)
      if (idx === -1) return prev
      const swap = direction === 'up' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= prev.length) return prev
      const next = [...prev]
      const tmp = next[swap]
      next[swap] = next[idx]
      next[idx] = tmp
      table.setColumnOrder(next)
      return next
    })
  }, [table])

  const perspectiveApiWarning = perspectiveApiMissing
    ? 'Perspectives API is not available yet. Run `npm run modules:prepare` to regenerate module routes, then restart the server.'
    : null

  React.useLayoutEffect(() => {
    if (!perspectiveEnabled) return
    if (!perspectiveData) return
    if (!perspectiveTableId) return
    if (initialPerspectiveAppliedRef.current && activePerspectiveId != null) return

    const tryResolve = (id: string | null | undefined): PerspectiveDto | RolePerspectiveDto | undefined => {
      if (!id) return undefined
      return perspectiveData.perspectives.find((p) => p.id === id)
        ?? perspectiveData.rolePerspectives.find((p) => p.id === id)
    }

    let target: PerspectiveDto | RolePerspectiveDto | undefined
    if (activePerspectiveId) {
      target = tryResolve(activePerspectiveId)
    }
    const cookieId = readPerspectiveCookie(perspectiveTableId)
    if (!target && cookieId) target = tryResolve(cookieId)
    if (!target && perspectiveData.defaultPerspectiveId) {
      target = tryResolve(perspectiveData.defaultPerspectiveId)
    }
    if (!target) {
      target = perspectiveData.rolePerspectives.find((p) => p.isDefault)
    }
    if (!target) {
      target = perspectiveData.perspectives[0]
    }
    if (target) {
      applyPerspectiveSettings(target.settings, target.id)
    }
    initialPerspectiveAppliedRef.current = true
  }, [perspectiveEnabled, perspectiveData, perspectiveTableId, applyPerspectiveSettings, activePerspectiveId])

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
  const resolvedEntityIds = React.useMemo(() => {
    if (Array.isArray(entityIds) && entityIds.length) {
      const dedup = new Set<string>()
      const list: string[] = []
      entityIds.forEach((id) => {
        const trimmed = typeof id === 'string' ? id.trim() : ''
        if (!trimmed || dedup.has(trimmed)) return
        dedup.add(trimmed)
        list.push(trimmed)
      })
      return list
    }
    if (typeof entityId === 'string' && entityId.trim().length > 0) {
      return [entityId.trim()]
    }
    return []
  }, [entityId, entityIds])
  const entityKey = React.useMemo(() => (resolvedEntityIds.length ? resolvedEntityIds.join('|') : null), [resolvedEntityIds])

  const { data: cfFilters = [] } = useCustomFieldFilterDefs(entityKey ? resolvedEntityIds : [], { enabled: !!entityKey })

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
    const perspectiveButton = perspectiveEnabled ? (
      <Button variant="outline" className="h-9" onClick={() => setPerspectiveOpen(true)}>
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        Perspectives
      </Button>
    ) : null
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
        leadingItems={perspectiveButton}
      />
    )
  }, [toolbar, searchValue, onSearchChange, searchPlaceholder, searchAlign, baseFilters, cfFilters, filterValues, onFiltersApply, onFiltersClear, perspectiveEnabled])

  const hasTitle = title != null
  const hasActions = actions !== undefined && actions !== null && actions !== false
  const shouldReserveActionsSpace = actions === null || actions === false
  const exportConfig = exporter === false ? null : exporter || null
  const resolvedExportSections = React.useMemo(() => resolveExportSections(exportConfig), [exportConfig])
  const hasExport = resolvedExportSections.length > 0
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
                  {perspectiveEnabled ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPerspectiveOpen(true)}
                      aria-label="Customize columns"
                      title="Customize columns"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">Customize columns</span>
                    </Button>
                  ) : null}
                  {exportConfig && hasExport ? <ExportMenu config={exportConfig} sections={resolvedExportSections} /> : null}
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
      {perspectiveEnabled ? (
        <PerspectiveSidebar
          open={isPerspectiveOpen}
          onOpenChange={setPerspectiveOpen}
          loading={perspectiveQuery.isFetching && !perspectiveQuery.data}
          perspectives={perspectiveData?.perspectives ?? []}
          rolePerspectives={perspectiveData?.rolePerspectives ?? []}
          roles={perspectiveData?.roles ?? []}
          activePerspectiveId={activePerspectiveId}
          onActivatePerspective={handlePerspectiveActivate}
          onDeletePerspective={handlePerspectiveDelete}
          onClearRole={handleClearRole}
          onSave={handlePerspectiveSave}
          canApplyToRoles={perspectiveData?.canApplyToRoles ?? false}
          columnOptions={columnOptions}
          onToggleColumn={handleToggleColumn}
          onMoveColumn={handleMoveColumn}
          saving={savePerspectiveMutation.isLoading}
          deletingIds={deletingIds}
          roleClearingIds={roleClearingIds}
          apiWarning={perspectiveApiWarning}
        />
      ) : null}
    </div>
  )
}
