"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender, type ColumnDef, type SortingState, type Column as TableColumn, type VisibilityState, type RowSelectionState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Loader2, SlidersHorizontal, MoreHorizontal, Circle, Filter, Columns3, ChevronUp, ChevronDown, ChevronsUpDown, Check } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/table'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select'
import { Spinner } from '../primitives/spinner'
import { TooltipProvider } from '../primitives/tooltip'
import { TruncatedCell } from './TruncatedCell'
import { FilterBar, type FilterDef, type FilterValues } from './FilterBar'
import { useCustomFieldFilterDefs } from './utils/customFieldFilters'
import { fetchCustomFieldDefinitionsPayload, type CustomFieldsetDto } from './utils/customFieldDefs'
import { RowActions, type RowActionItem } from './RowActions'
import { subscribeOrganizationScopeChanged, type OrganizationScopeChangedDetail } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { InjectionSpot } from './injection/InjectionSpot'
import { useAppEvent } from './injection/useAppEvent'
import { useInjectionDataWidgets } from './injection/useInjectionDataWidgets'
import { resolveInjectedIcon } from './injection/resolveInjectedIcon'
import { serializeExport, defaultExportFilename, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import { apiCall } from './utils/apiCall'
import { raiseCrudError } from './utils/serverErrors'
import { PerspectiveSidebar } from './PerspectiveSidebar'
import { Popover, PopoverTrigger, PopoverContent } from '../primitives/popover'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from './FlashMessages'
import { useConfirmDialog } from './confirm-dialog'
import type {
  PerspectiveDto,
  RolePerspectiveDto,
  PerspectivesIndexResponse,
  PerspectiveSettings,
  PerspectiveSaveResponse,
} from '@open-mercato/shared/modules/perspectives/types'
import type {
  InjectionColumnDefinition,
  InjectionBulkActionDefinition,
  InjectionFilterDefinition,
  InjectionRowActionDefinition,
} from '@open-mercato/shared/modules/widgets/injection'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'
import { insertByInjectionPlacement } from '@open-mercato/shared/modules/widgets/injection-position'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { FilterFieldDef as AdvancedFilterFieldDef } from '@open-mercato/shared/lib/query/advanced-filter'
import { getDefaultOperator } from '@open-mercato/shared/lib/query/advanced-filter'
import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { treeReducer } from './filters/treeReducer'
import { AdvancedFilterBuilder } from './filters/AdvancedFilterBuilder'
import { type ColumnChooserField } from './columns/ColumnChooserPanel'
import { useAutoDiscoveredFields } from './utils/useAutoDiscoveredFields'
import { useCustomFieldDefs } from './utils/customFieldDefs'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  durationMs?: number | null
  cacheStatus?: 'hit' | 'miss' | null
  pageSizeOptions?: number[]
  onPageSizeChange?: (pageSize: number) => void
}

export type DataTableRefreshButton = {
  onRefresh: () => void
  label: string
  isRefreshing?: boolean
  disabled?: boolean
}

const DEFAULT_ROW_CLICK_ACTION_IDS = ['edit', 'open']

export function withDataTableNamespaces<T extends Record<string, unknown>>(
  mappedRow: T,
  sourceItem: Record<string, unknown>,
): T & Record<string, unknown> {
  const namespaced: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sourceItem)) {
    if (!key.startsWith('_')) continue
    namespaced[key] = value
  }
  return {
    ...mappedRow,
    ...namespaced,
  }
}

function resolveDataTableRowId<T>(row: T, index: number): string {
  if (row && typeof row === 'object') {
    const candidate = (row as Record<string, unknown>).id
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate
    }
  }
  return String(index)
}

function resolveDefaultRowAction(items: RowActionItem[], preferredIds: string[]): RowActionItem | null {
  for (const preferredId of preferredIds) {
    const match = items.find((item) => item.id === preferredId && (item.href || item.onSelect))
    if (match) return match
  }
  for (const preferredId of preferredIds) {
    const match = items.find((item) => item.label.toLowerCase() === preferredId && (item.href || item.onSelect))
    if (match) return match
  }
  return null
}

function pickDefaultRowAction(node: React.ReactNode, preferredIds: string[]): RowActionItem | null {
  if (!React.isValidElement(node)) return null
  const items = (node.props as { items?: RowActionItem[] }).items
  if (!Array.isArray(items)) return null
  return resolveDefaultRowAction(items, preferredIds)
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
    initialSettings?: PerspectiveSettings | null
  }
}

export type BulkAction<T = Record<string, unknown>> = {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
  destructive?: boolean
  onExecute: (selectedRows: T[]) => Promise<void | boolean | BulkActionExecuteResult> | void | boolean | BulkActionExecuteResult
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
  emptyState?: React.ReactNode
  error?: React.ReactNode | string | null
  rowActions?: (row: T) => React.ReactNode
  onRowClick?: (row: T) => void
  rowClickActionIds?: string[]
  disableRowClick?: boolean
  bulkActions?: BulkAction<T>[]
  selectionScopeKey?: string

  // Auto FilterBar options (rendered as toolbar when provided and no custom toolbar passed)
  searchValue?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  searchAlign?: 'left' | 'right'
  filters?: FilterDef[]
  filterValues?: FilterValues
  onFiltersApply?: (values: FilterValues) => void
  onFiltersClear?: () => void
  entityId?: string
  entityIds?: string[]
  exporter?: DataTableExportConfig | false
  perspective?: DataTablePerspectiveConfig
  embedded?: boolean
  onCustomFieldFilterFieldsetChange?: (fieldset: string | null, entityId?: string) => void
  customFieldFilterKeyExtras?: Array<string | number | boolean | null | undefined>
  injectionSpotId?: string
  injectionContext?: Record<string, unknown>
  replacementHandle?: string
  stickyFirstColumn?: boolean
  stickyActionsColumn?: boolean
  virtualized?: boolean
  virtualizedMaxHeight?: number | string
  virtualizedOverscan?: number
  advancedFilter?: {
    fields?: AdvancedFilterFieldDef[]
    auto?: boolean
    value: AdvancedFilterTree
    onChange: (state: AdvancedFilterTree) => void
    onApply: () => void
    onClear: () => void
  }
  columnChooser?: {
    availableColumns?: ColumnChooserField[]
    auto?: boolean
  }
}

const DEFAULT_EXPORT_FORMATS: DataTableExportFormat[] = ['csv', 'json', 'xml', 'markdown']
const EXPORT_LABELS: Record<DataTableExportFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  xml: 'XML',
  markdown: 'Markdown',
}
const EMPTY_FILTER_DEFS: FilterDef[] = []
const EMPTY_FILTER_VALUES: FilterValues = Object.freeze({}) as FilterValues

type BulkActionExecuteResult = {
  ok: boolean
  message?: string
  affectedCount?: number
  progressJobId?: string | null
}

function collectUniqueById<T extends { id: string }>(
  entries: T[],
  warningScope: string,
): T[] {
  const byId = new Map<string, T>()
  for (const entry of entries) {
    if (!entry.id) continue
    if (byId.has(entry.id)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[UMES] Duplicate injected ${warningScope} id "${entry.id}" detected. Keeping the first entry.`)
      }
      continue
    }
    byId.set(entry.id, entry)
  }
  return Array.from(byId.values())
}

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
const PERSPECTIVE_STORAGE_PREFIX = 'om_table_perspective_snapshot'

function formatDurationLabel(durationMs?: number | null): string {
  if (durationMs == null) return ''
  if (!Number.isFinite(durationMs)) return ''
  if (durationMs < 0) return ''
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`
  if (durationMs < 3_600_000) return `${(durationMs / 60_000).toFixed(durationMs < 600_000 ? 1 : 0)}m`
  return `${(durationMs / 3_600_000).toFixed(durationMs < 7_200_000 ? 1 : 0)}h`
}

type PerspectiveSnapshot = {
  perspectiveId: string | null
  settings: PerspectiveSettings
  updatedAt: number
}

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

function readPerspectiveSnapshot(tableId: string): PerspectiveSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${PERSPECTIVE_STORAGE_PREFIX}:${tableId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const perspectiveId =
      typeof parsed.perspectiveId === 'string' && parsed.perspectiveId.trim().length > 0
        ? parsed.perspectiveId
        : null
    const settings = typeof parsed.settings === 'object' && parsed.settings !== null
      ? parsed.settings as PerspectiveSettings
      : null
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
    if (!settings) return null
    return { perspectiveId, settings, updatedAt }
  } catch {
    return null
  }
}

function writePerspectiveSnapshot(tableId: string, snapshot: PerspectiveSnapshot | null) {
  if (typeof window === 'undefined') return
  const key = `${PERSPECTIVE_STORAGE_PREFIX}:${tableId}`
  try {
    if (!snapshot) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // ignore storage errors
  }
}

function sanitizePerspectiveSettings(source?: PerspectiveSettings | null): PerspectiveSettings | null {
  if (!source || typeof source !== 'object') return null
  const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
  const result: PerspectiveSettings = {}

  if (Array.isArray(source.columnOrder)) {
    const seen = new Set<string>()
    const order = source.columnOrder
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0 && !seen.has(id) && (seen.add(id), true))
    if (order.length) result.columnOrder = order
  }

  if (source.columnVisibility && typeof source.columnVisibility === 'object') {
    const entries = Object.entries(source.columnVisibility)
      .filter(([key, value]) => typeof key === 'string' && key.trim().length > 0 && !forbidden.has(key) && typeof value === 'boolean')
    if (entries.length) {
      const visibility: Record<string, boolean> = {}
      entries.forEach(([key, value]) => { visibility[key] = value })
      result.columnVisibility = visibility
    }
  }

  if (Array.isArray(source.sorting)) {
    const sorting = source.sorting
      .map((item) => {
        const id = typeof item?.id === 'string' ? item.id.trim() : ''
        if (!id || forbidden.has(id)) return null
        return { id, desc: Boolean(item?.desc) }
      })
      .filter((item): item is { id: string; desc: boolean } => item !== null)
    if (sorting.length) result.sorting = sorting
  }

  if (typeof source.pageSize === 'number' && Number.isFinite(source.pageSize)) {
    const pageSize = Math.max(1, Math.min(500, Math.floor(source.pageSize)))
    result.pageSize = pageSize
  }

  if (typeof source.searchValue === 'string' && source.searchValue.trim().length > 0) {
    result.searchValue = source.searchValue.trim().slice(0, 200)
  }

  if (source.filters && typeof source.filters === 'object') {
    const filters: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source.filters)) {
      if (typeof key === 'string') {
        const trimmed = key.trim()
        if (trimmed.length > 0 && !forbidden.has(trimmed)) filters[trimmed] = value
      }
    }
    if (Object.keys(filters).length) result.filters = filters
  }

  return Object.keys(result).length ? result : null
}

function normalizeLabel(input: string): string {
  if (!input) return ''
  return input
    .replace(/^cf[_:]/, '')
    .replace(/[_:\-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

// Column width configuration based on column type
type ColumnTruncateConfig = {
  maxWidth: string
  truncate: boolean
}

type ColumnTruncateMeta = {
  truncate?: boolean
  maxWidth?: string
}

function getColumnTruncateConfig(columnId: string, accessorKey?: string, columnMeta?: ColumnTruncateMeta): ColumnTruncateConfig {
  const key = accessorKey || columnId
  const metaMaxWidth = typeof columnMeta?.maxWidth === 'string' ? columnMeta.maxWidth.trim() : ''

  // Custom fields get narrower width
  if (key.startsWith('cf_') || key.startsWith('cf:')) {
    return {
      maxWidth: metaMaxWidth || '120px',
      truncate: typeof columnMeta?.truncate === 'boolean' ? columnMeta.truncate : true,
    }
  }

  // Core informative columns get wider width
  const wideColumns = ['title', 'name', 'description', 'source', 'companies', 'people']
  if (wideColumns.includes(key)) {
    return {
      maxWidth: metaMaxWidth || '250px',
      truncate: typeof columnMeta?.truncate === 'boolean' ? columnMeta.truncate : true,
    }
  }

  // Medium width for status-like columns
  const mediumColumns = ['status', 'pipelineStage', 'pipeline_stage', 'type', 'category']
  if (mediumColumns.includes(key)) {
    return {
      maxWidth: metaMaxWidth || '180px',
      truncate: typeof columnMeta?.truncate === 'boolean' ? columnMeta.truncate : true,
    }
  }

  // Date columns
  if (key.endsWith('_at') || key.endsWith('At') || key.includes('date') || key.includes('Date')) {
    return {
      maxWidth: metaMaxWidth || '120px',
      truncate: typeof columnMeta?.truncate === 'boolean' ? columnMeta.truncate : true,
    }
  }

  // Default for other columns
  return {
    maxWidth: metaMaxWidth || '150px',
    truncate: typeof columnMeta?.truncate === 'boolean' ? columnMeta.truncate : true,
  }
}

function readInjectedColumnValue(row: unknown, accessorKey: string): unknown {
  if (!row || typeof row !== 'object' || !accessorKey) return undefined
  const segments = accessorKey.split('.').filter((segment) => segment.length > 0)
  if (segments.length === 0) return undefined
  let current: unknown = row
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

// Check if a column should skip truncation (e.g., actions column)
function shouldSkipTruncation(columnId: string): boolean {
  const skipColumns = ['actions', 'select', 'checkbox', 'expand']
  return skipColumns.includes(columnId.toLowerCase())
}

function ExportMenu({ config, sections }: { config: DataTableExportConfig; sections: ResolvedExportSection[] }) {
  const t = useT()
  const { label } = config
  const defaultLabel = label ?? t('ui.dataTable.export.label', 'Export')
  const disabled = Boolean(config.disabled)
  const hasSections = sections.length > 0
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open || !hasSections) return
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
  }, [hasSections, open])

  if (!hasSections) return null

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
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
      >
        {defaultLabel}
      </Button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 mt-2 w-60 rounded-md border bg-background py-2 shadow z-dropdown"
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
                  <Button
                    key={`${section.key}-${format}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start font-normal"
                    onClick={() => void handleSelect(section, format)}
                    disabled={section.disabled}
                  >
                    {EXPORT_LABELS[format]}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function sanitizeDndContextId(value: string): string {
  const trimmed = value.trim().toLowerCase()
  let normalized = ''
  let previousWasDash = false

  for (const character of trimmed) {
    const isLowercaseLetter = character >= 'a' && character <= 'z'
    const isDigit = character >= '0' && character <= '9'

    if (isLowercaseLetter || isDigit || character === '_') {
      normalized += character
      previousWasDash = false
      continue
    }

    if (!previousWasDash) {
      normalized += '-'
      previousWasDash = true
    }
  }

  while (normalized.startsWith('-')) {
    normalized = normalized.slice(1)
  }

  while (normalized.endsWith('-')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized.length > 0 ? normalized : 'data-table'
}

function HeaderDndWrapper({ enabled, contextId, sensors, columnIds, onDragEnd, children }: {
  enabled: boolean
  contextId: string
  sensors: ReturnType<typeof useSensors>
  columnIds: string[]
  onDragEnd: (event: DragEndEvent) => void
  children: React.ReactNode
}) {
  if (!enabled) return <>{children}</>
  return (
    <DndContext id={contextId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

function SortableHeaderCell({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const isSticky = typeof className === 'string' && className.includes('sticky')
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
    position: isSticky ? 'sticky' : 'relative',
  }
  return (
    <TableHead ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {children}
    </TableHead>
  )
}

function ViewSwitcherDropdown({
  activePerspectiveId,
  perspectives,
  rolePerspectives,
  onClear,
  onActivate,
  onOpenSidebar,
  t,
}: {
  activePerspectiveId: string | null
  perspectives: PerspectiveDto[]
  rolePerspectives: RolePerspectiveDto[]
  onClear: () => void
  onActivate: (item: PerspectiveDto | RolePerspectiveDto, source: 'personal' | 'role') => void
  onOpenSidebar: () => void
  t: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = React.useState(false)
  const allViews = [...perspectives, ...rolePerspectives]
  const activeName = allViews.find((v) => v.id === activePerspectiveId)?.name.trim() || ''
  const activeLabel = activeName || t('ui.dataTable.perspectives.allViews', 'All views')
  return (
    <div className="inline-flex h-9 items-center rounded-md border border-input text-sm">
      <Button
        data-testid="data-table-open-views-sidebar"
        type="button"
        variant="ghost"
        size="sm"
        onClick={onOpenSidebar}
        className="h-full rounded-none rounded-l-md px-3 font-medium"
      >
        <SlidersHorizontal className="size-4 mr-1.5" />
        {t('ui.dataTable.perspectives.button', 'Views')}
      </Button>
      <div className="h-5 w-px bg-border" />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-full max-w-[200px] rounded-none rounded-r-md px-3 font-normal text-muted-foreground"
          >
            <span className="truncate">{activeLabel}</span>
            <ChevronDown className="size-3.5 shrink-0 ml-1.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[220px] p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start h-auto px-2 py-1.5 text-sm font-normal',
              !activePerspectiveId && 'bg-accent text-accent-foreground'
            )}
            onClick={() => { onClear(); setOpen(false) }}
          >
            <Check className={cn('size-4 shrink-0 mr-2', activePerspectiveId ? 'invisible' : '')} />
            {t('ui.dataTable.perspectives.noView', '— No view —')}
          </Button>
          {perspectives.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'w-full justify-start h-auto px-2 py-1.5 text-sm font-normal',
                activePerspectiveId === p.id && 'bg-accent text-accent-foreground'
              )}
              onClick={() => { onActivate(p, 'personal'); setOpen(false) }}
            >
              <Check className={cn('size-4 shrink-0 mr-2', activePerspectiveId !== p.id ? 'invisible' : '')} />
              <span className="truncate">{p.name.trim() || t('ui.perspectives.untitled', 'Untitled view')}</span>
            </Button>
          ))}
          {rolePerspectives.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'w-full justify-start h-auto px-2 py-1.5 text-sm font-normal',
                activePerspectiveId === p.id && 'bg-accent text-accent-foreground'
              )}
              onClick={() => { onActivate(p, 'role'); setOpen(false) }}
            >
              <Check className={cn('size-4 shrink-0 mr-2', activePerspectiveId !== p.id ? 'invisible' : '')} />
              <span className="truncate">{p.name.trim() || t('ui.perspectives.untitled', 'Untitled view')}</span>
            </Button>
          ))}
        </PopoverContent>
      </Popover>
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
  emptyState,
  error,
  rowActions,
  onRowClick,
  rowClickActionIds,
  disableRowClick = false,
  bulkActions: bulkActionsProp,
  selectionScopeKey,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchAlign = 'left',
  filters: baseFilters = EMPTY_FILTER_DEFS,
  filterValues = EMPTY_FILTER_VALUES,
  onFiltersApply,
  onFiltersClear,
  entityId,
  entityIds,
  exporter,
  perspective,
  embedded = false,
  onCustomFieldFilterFieldsetChange,
  customFieldFilterKeyExtras,
  injectionSpotId,
  injectionContext,
  replacementHandle,
  stickyFirstColumn = false,
  stickyActionsColumn = false,
  virtualized = false,
  virtualizedMaxHeight,
  virtualizedOverscan = 10,
  advancedFilter,
  columnChooser,
}: DataTableProps<T>) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const resolvedRowClickActionIds = rowClickActionIds ?? DEFAULT_ROW_CLICK_ACTION_IDS
  const containerRef = React.useRef<HTMLDivElement>(null)
  const lastScopeRef = React.useRef<OrganizationScopeChangedDetail | null>(null)
  const hasInitializedScopeRef = React.useRef(false)
  React.useEffect(() => {
    return subscribeOrganizationScopeChanged((detail) => {
      const prev = lastScopeRef.current
      lastScopeRef.current = detail
      if (!hasInitializedScopeRef.current) {
        hasInitializedScopeRef.current = true
        return
      }
      if (
        prev &&
        prev.organizationId === detail.organizationId &&
        prev.tenantId === detail.tenantId
      ) {
        return
      }
      scheduleRouterRefresh(router)
    })
  }, [router])
  const queryClient = useQueryClient()
  const perspectiveConfig = perspective ?? null
  const perspectiveTableId = perspectiveConfig?.tableId ?? null
  const perspectiveEnabled = Boolean(perspectiveTableId)
  // Snapshot from localStorage is read post-mount via useLayoutEffect to avoid SSR/CSR
  // hydration mismatch. Initial render uses only props-derived state (identical on both sides).
  const initialSnapshotRef = React.useRef<PerspectiveSnapshot | null>(null)
  const snapshotHydratedTableRef = React.useRef<string | null>(null)
  const initialSettingsFromConfig = sanitizePerspectiveSettings(perspectiveConfig?.initialState?.initialSettings ?? null)
  const mergedInitialSettings = initialSettingsFromConfig
  const initialActiveId = perspectiveConfig?.initialState?.activePerspectiveId ?? null
  const [isPerspectiveOpen, setPerspectiveOpen] = React.useState(false)
  const [isAdvancedFilterOpen, setAdvancedFilterOpen] = React.useState(false)
  const [activePerspectiveId, setActivePerspectiveId] = React.useState<string | null>(initialActiveId)
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => mergedInitialSettings?.columnVisibility ?? {})
  const [columnOrder, setColumnOrder] = React.useState<string[]>(() => mergedInitialSettings?.columnOrder ?? [])
  const [deletingIds, setDeletingIds] = React.useState<string[]>([])
  const [roleClearingIds, setRoleClearingIds] = React.useState<string[]>([])
  const [perspectiveApiMissing, setPerspectiveApiMissing] = React.useState(false)

  const perspectiveFeatureQuery = useQuery<{ use: boolean; roleDefaults: boolean }>({
    queryKey: ['feature-check', 'perspectives'],
    enabled: perspectiveEnabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const call = await apiCall<{ granted?: unknown[] }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features: ['perspectives.use', 'perspectives.role_defaults'] }),
          },
        )
        if (!call.ok) throw new Error(`feature-check failed (${call.status})`)
        const data = call.result ?? {}
        const granted = Array.isArray(data?.granted) ? data.granted.map((f: any) => String(f)) : []
        const has = (feature: string) => granted.some((grantedFeature: string) => {
          if (grantedFeature === '*') return true
          if (grantedFeature === feature) return true
          if (grantedFeature.endsWith('.*')) {
            const prefix = grantedFeature.slice(0, -2)
            return feature === prefix || feature.startsWith(`${prefix}.`)
          }
          return false
        })
        return {
          use: has('perspectives.use'),
          roleDefaults: has('perspectives.role_defaults'),
        }
      } catch {
        return {
          use: true,
          roleDefaults: true,
        }
      }
    },
  })
  const perspectivePermissions = perspectiveFeatureQuery.data
  const canUsePerspectives = perspectiveEnabled && Boolean(perspectivePermissions?.use)
  const canUseRoleDefaultsFeature = Boolean(perspectivePermissions?.roleDefaults)

  React.useEffect(() => {
    if (!canUsePerspectives && isPerspectiveOpen) {
      setPerspectiveOpen(false)
    }
  }, [canUsePerspectives, isPerspectiveOpen])

  React.useEffect(() => {
    if (!perspectiveTableId) return
    if (!mergedInitialSettings) return
    const snapshot: PerspectiveSnapshot = {
      perspectiveId: initialActiveId,
      settings: mergedInitialSettings,
      updatedAt: Date.now(),
    }
    writePerspectiveSnapshot(perspectiveTableId, snapshot)
    initialSnapshotRef.current = snapshot
  }, [perspectiveTableId, mergedInitialSettings, initialActiveId])

  const perspectiveQuery = useQuery<PerspectivesIndexResponse>({
    queryKey: ['table-perspectives', perspectiveTableId],
    queryFn: async () => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const call = await apiCall<PerspectivesIndexResponse>(`/api/perspectives/${encodeURIComponent(perspectiveTableId)}`)
      if (call.status === 404) {
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
      if (!call.ok) {
        await raiseCrudError(call.response, t('ui.dataTable.perspectives.error.load', 'Failed to load perspectives'))
      }
      setPerspectiveApiMissing(false)
      const payload = call.result
      if (!payload) throw new Error(t('ui.dataTable.perspectives.error.load', 'Failed to load perspectives'))
      return payload
    },
    enabled: canUsePerspectives,
    initialData: perspectiveConfig?.initialState?.response,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })
  const perspectiveData = perspectiveQuery.data
  const initialPerspectiveAppliedRef = React.useRef(Boolean(mergedInitialSettings))

  const extensionTableId = React.useMemo(() => {
    if (perspective?.tableId) return perspective.tableId
    if (injectionSpotId?.startsWith('data-table:')) return injectionSpotId.slice('data-table:'.length)
    return null
  }, [injectionSpotId, perspective?.tableId])
  const resolvedInjectionSpotId = injectionSpotId ?? (perspective?.tableId ? `data-table:${perspective.tableId}` : null)
  const resolvedReplacementHandle = replacementHandle ?? ComponentReplacementHandles.dataTable(extensionTableId ?? 'unknown')
  const baseInjectionContext = React.useMemo(
    () => injectionContext ?? { tableId: perspective?.tableId ?? null, title: typeof title === 'string' ? title : undefined },
    [injectionContext, perspective?.tableId, title]
  )
  const headerInjectionSpotId = React.useMemo(
    () => (resolvedInjectionSpotId ? `${resolvedInjectionSpotId}:header` : null),
    [resolvedInjectionSpotId]
  )
  const toolbarInjectionSpotId = React.useMemo(
    () => (resolvedInjectionSpotId ? `${resolvedInjectionSpotId}:toolbar` : null),
    [resolvedInjectionSpotId]
  )
  const searchTrailingInjectionSpotId = React.useMemo(
    () => (resolvedInjectionSpotId ? `${resolvedInjectionSpotId}:search-trailing` : null),
    [resolvedInjectionSpotId]
  )
  const footerInjectionSpotId = React.useMemo(
    () => (resolvedInjectionSpotId ? `${resolvedInjectionSpotId}:footer` : null),
    [resolvedInjectionSpotId]
  )
  const { widgets: columnWidgets } = useInjectionDataWidgets(
    extensionTableId ? `data-table:${extensionTableId}:columns` : '__disabled__:columns',
  )
  const { widgets: rowActionWidgets } = useInjectionDataWidgets(
    extensionTableId ? `data-table:${extensionTableId}:row-actions` : '__disabled__:row-actions',
  )
  const { widgets: bulkActionWidgets } = useInjectionDataWidgets(
    extensionTableId ? `data-table:${extensionTableId}:bulk-actions` : '__disabled__:bulk-actions',
  )
  const { widgets: filterWidgets } = useInjectionDataWidgets(
    extensionTableId ? `data-table:${extensionTableId}:filters` : '__disabled__:filters',
  )
  const injectedColumnDefs = React.useMemo<{ def: ColumnDef<T, unknown>; placement: InjectionColumnDefinition['placement'] }[]>(() => {
    const entries: InjectionColumnDefinition[] = []
    for (const widget of columnWidgets) {
      if (!('columns' in widget)) continue
      for (const definition of widget.columns ?? []) {
        entries.push(definition)
      }
    }
    return collectUniqueById(entries, 'column').map((definition) => ({
      def: {
        id: definition.id,
        accessorFn: (row: T) => readInjectedColumnValue(row, definition.accessorKey),
        header: t(definition.header, definition.header),
        cell: definition.cell as ColumnDef<T, unknown>['cell'],
        size: definition.size,
        enableSorting: definition.sortable === true,
      },
      placement: definition.placement,
    }))
  }, [columnWidgets, t])
  const injectedRowActions = React.useMemo<InjectionRowActionDefinition[]>(() => {
    const entries: InjectionRowActionDefinition[] = []
    for (const widget of rowActionWidgets) {
      if (!('rowActions' in widget)) continue
      for (const definition of widget.rowActions ?? []) {
        entries.push(definition)
      }
    }
    return collectUniqueById(entries, 'row action')
  }, [rowActionWidgets])
  const injectedBulkActions = React.useMemo<InjectionBulkActionDefinition[]>(() => {
    const entries: InjectionBulkActionDefinition[] = []
    for (const widget of bulkActionWidgets) {
      if (!('bulkActions' in widget)) continue
      for (const definition of widget.bulkActions ?? []) {
        entries.push(definition)
      }
    }
    return collectUniqueById(entries, 'bulk action')
  }, [bulkActionWidgets])
  const { serverFilters: injectedFilters, clientFilters: injectedClientFilters } = React.useMemo<{
    serverFilters: FilterDef[]
    clientFilters: { id: string; filterFn: (row: unknown, value: unknown) => boolean }[]
  }>(() => {
    const byId = new Map<string, FilterDef>()
    const clientEntries: { id: string; filterFn: (row: unknown, value: unknown) => boolean }[] = []
    for (const widget of filterWidgets) {
      if (!('filters' in widget)) continue
      for (const definition of widget.filters ?? []) {
        const filter = definition as InjectionFilterDefinition
        const mappedType: FilterDef['type'] =
          filter.type === 'date-range'
            ? 'dateRange'
            : filter.type === 'boolean'
              ? 'checkbox'
              : filter.type === 'select'
                ? 'select'
                : 'text'
        const id = filter.queryParam ?? filter.id
        if (filter.strategy === 'client' && filter.filterFn) {
          clientEntries.push({ id, filterFn: filter.filterFn })
        }
        if (!byId.has(id)) {
          const translatedOptions = Array.isArray(filter.options)
            ? filter.options.map((option) => ({
                ...option,
                label: t(option.label, option.label),
              }))
            : filter.options
          byId.set(id, {
            id,
            label: t(filter.label, filter.label),
            type: mappedType,
            options: translatedOptions,
          })
        }
      }
    }
    return { serverFilters: Array.from(byId.values()), clientFilters: clientEntries }
  }, [filterWidgets, t])
  const mergedColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!injectedColumnDefs.length) return columns
    let result = [...columns]
    for (const { def, placement } of injectedColumnDefs) {
      result = insertByInjectionPlacement(
        result,
        def,
        placement,
        (col) => (col as { id?: string }).id ?? '',
      )
    }
    return result
  }, [columns, injectedColumnDefs])
  const resolvedRowActions = React.useCallback((row: T) => {
    const injectedItems: (RowActionItem & { placement?: InjectionRowActionDefinition['placement'] })[] = injectedRowActions.map((action) => ({
      id: action.id,
      label: t(action.label, action.label),
      onSelect: () => action.onSelect(row, { navigate: (href: string) => router.push(href) }),
      placement: action.placement,
    }))
    const baseNode = rowActions ? rowActions(row) : null
    if (!injectedItems.length) return baseNode
    if (React.isValidElement(baseNode)) {
      const baseItems = (baseNode.props as { items?: RowActionItem[] }).items
      if (Array.isArray(baseItems)) {
        let merged = [...baseItems]
        const existingIds = new Set(
          baseItems.map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
        for (const item of injectedItems) {
          if (item.id && existingIds.has(item.id)) continue
          merged = insertByInjectionPlacement(
            merged,
            item,
            item.placement,
            (entry) => entry.id ?? '',
          )
        }
        return <RowActions items={merged} />
      }
    }
    return <RowActions items={injectedItems} />
  }, [injectedRowActions, rowActions, router, t])

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
    const accessors = mergedColumns.map((c) => {
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
  }, [dateColumnIds, data, mergedColumns])
  // Column visibility: only hide columns explicitly marked as hidden.
  // All other columns are always rendered; horizontal scroll (min-w + overflow-auto)
  // handles narrow viewports so users can swipe to reach every column.
  const responsiveClass = (_priority?: number, hidden?: boolean) => {
    if (hidden) return ''
    return ''
  }

  const resolvePriority = React.useCallback((column: TableColumn<T, unknown>) => {
    const meta = (column.columnDef as any)?.meta
    const rawPriority = typeof meta?.priority === 'number' ? meta.priority : undefined
    if (rawPriority && rawPriority > 0) return rawPriority
    const index = column.getIndex()
    return index <= 1 ? 1 : 2
  }, [])

  const initialSorting = React.useMemo<SortingState>(() => {
    if (mergedInitialSettings?.sorting) {
      return mergedInitialSettings.sorting.map((item) => ({ id: item.id, desc: Boolean(item.desc) }))
    }
    return []
  }, [mergedInitialSettings])
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (sortingProp && sortingProp.length) return sortingProp
    if (initialSorting.length) return initialSorting
    return []
  })
  const clientFilteredData = React.useMemo(() => {
    if (!injectedClientFilters.length || !filterValues) return data
    const activeClientFilters = injectedClientFilters.filter(
      (cf) => filterValues[cf.id] !== undefined && filterValues[cf.id] !== '' && filterValues[cf.id] !== null,
    )
    if (!activeClientFilters.length) return data
    return data.filter((row) =>
      activeClientFilters.every((cf) => cf.filterFn(row, filterValues[cf.id])),
    )
  }, [data, injectedClientFilters, filterValues])
  const hasPropBulkActions = Array.isArray(bulkActionsProp) && bulkActionsProp.length > 0
  const hasInjectedBulkActions = injectedBulkActions.length > 0 || hasPropBulkActions
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const selectionScopeKeyRef = React.useRef<string | undefined>(selectionScopeKey)
  const table = useReactTable<T>({
    data: clientFilteredData,
    columns: mergedColumns,
    getCoreRowModel: getCoreRowModel(),
    ...(sortable ? { getSortedRowModel: getSortedRowModel() } : {}),
    getRowId: resolveDataTableRowId,
    state: { sorting, columnVisibility, columnOrder, rowSelection },
    enableRowSelection: hasInjectedBulkActions,
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
    onRowSelectionChange: setRowSelection,
  })
  React.useEffect(() => { if (sortingProp) setSorting(sortingProp) }, [sortingProp])
  React.useEffect(() => {
    if (selectionScopeKey === undefined) {
      selectionScopeKeyRef.current = undefined
      return
    }
    if (selectionScopeKeyRef.current === undefined) {
      selectionScopeKeyRef.current = selectionScopeKey
      return
    }
    if (selectionScopeKeyRef.current === selectionScopeKey) return
    selectionScopeKeyRef.current = selectionScopeKey
    setRowSelection({})
  }, [selectionScopeKey])
  React.useEffect(() => {
    if (hasInjectedBulkActions) return
    if (Object.keys(rowSelection).length === 0) return
    setRowSelection({})
  }, [hasInjectedBulkActions, rowSelection])
  const resolvedInjectionContext = React.useMemo(
    () => {
      if (!hasInjectedBulkActions) return baseInjectionContext
      const selectedIds = Object.keys(rowSelection).filter((key) => rowSelection[key])
      if (selectedIds.length === 0) return baseInjectionContext
      return { ...baseInjectionContext, _selectedRowIds: selectedIds, _selectedCount: selectedIds.length }
    },
    [baseInjectionContext, hasInjectedBulkActions, rowSelection],
  )
  React.useEffect(() => {
    const ids = table.getAllLeafColumns().map((column) => column.id)
    if (!ids.length) return
    setColumnOrder((prev) => {
      if (!prev.length) return ids
      const allowed = ids
      const filtered = prev.filter((id) => allowed.includes(id))
      const seen = new Set(filtered)
      for (const id of allowed) {
        if (!seen.has(id)) {
          filtered.push(id)
          seen.add(id)
        }
      }
      const changed = filtered.length !== prev.length || filtered.some((id, index) => id !== prev[index])
      return changed ? filtered : prev
    })
  }, [table, mergedColumns])

  const initialVisibilityApplied = React.useRef(Boolean(mergedInitialSettings?.columnVisibility))
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
  }, [table, mergedColumns])

  const getCurrentSettings = React.useCallback((): PerspectiveSettings => {
    const visibility: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(columnVisibility)) {
      if (typeof key === 'string' && typeof value === 'boolean') {
        visibility[key] = value
      }
    }
    const filtersRecord: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(filterValues ?? {})) {
      if (typeof key === 'string') filtersRecord[key] = value
    }
    const candidate: PerspectiveSettings = {
      columnOrder,
      columnVisibility: visibility,
      sorting,
      filters: filtersRecord,
      searchValue,
    }
    return sanitizePerspectiveSettings(candidate) ?? {}
  }, [columnOrder, columnVisibility, sorting, filterValues, searchValue])

  const applyPerspectiveSettings = React.useCallback((settings: PerspectiveSettings, nextId: string | null) => {
    const normalized = sanitizePerspectiveSettings(settings) ?? {}
    if (normalized.columnOrder && normalized.columnOrder.length) {
      setColumnOrder(normalized.columnOrder)
    } else {
      const ids = table.getAllLeafColumns().map((column) => column.id)
      if (ids.length) setColumnOrder(ids)
    }
    if (normalized.columnVisibility) setColumnVisibility(normalized.columnVisibility)
    else setColumnVisibility({})
    if (normalized.sorting) {
      const sortingState: SortingState = normalized.sorting.map((item) => ({
        id: item.id,
        desc: item.desc === true,
      }))
      setSorting(sortingState)
      onSortingChange?.(sortingState)
    } else {
      setSorting([])
      onSortingChange?.([])
    }
    if (onFiltersApply) {
      onFiltersApply((normalized.filters ?? {}) as FilterValues)
    }
    if (onSearchChange) {
      onSearchChange(normalized.searchValue ?? '')
    }
    setActivePerspectiveId(nextId)
    if (perspectiveTableId) {
      writePerspectiveCookie(perspectiveTableId, nextId)
      if (nextId) {
        const snapshot: PerspectiveSnapshot = { perspectiveId: nextId, settings: normalized, updatedAt: Date.now() }
        writePerspectiveSnapshot(perspectiveTableId, snapshot)
        initialSnapshotRef.current = snapshot
      } else {
        writePerspectiveSnapshot(perspectiveTableId, null)
        initialSnapshotRef.current = null
      }
    }
  }, [onFiltersApply, onSearchChange, onSortingChange, perspectiveTableId, table])

  React.useLayoutEffect(() => {
    if (!perspectiveTableId) return
    if (snapshotHydratedTableRef.current === perspectiveTableId) return
    snapshotHydratedTableRef.current = perspectiveTableId
    const snapshot = readPerspectiveSnapshot(perspectiveTableId)
    if (!snapshot) return
    initialSnapshotRef.current = snapshot
    applyPerspectiveSettings(snapshot.settings, snapshot.perspectiveId ?? null)
    initialPerspectiveAppliedRef.current = true
  }, [perspectiveTableId, applyPerspectiveSettings])

  type SavePerspectivePayload = {
    name: string
    isDefault: boolean
    applyToRoles: string[]
    setRoleDefault: boolean
    perspectiveId?: string | null
    settings?: PerspectiveSettings
  }

  const perspectiveQueryKey: [string, string | null] = ['table-perspectives', perspectiveTableId]
  const savePerspectiveMutation = useMutation<PerspectiveSaveResponse, Error, SavePerspectivePayload>({
    mutationFn: async (input) => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const payload = {
        perspectiveId: input.perspectiveId ?? undefined,
        name: input.name,
        settings: input.settings ?? getCurrentSettings(),
        isDefault: input.isDefault,
        applyToRoles: input.applyToRoles,
        setRoleDefault: input.setRoleDefault,
      }
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[DataTable] perspective payload', payload)
      }
      const call = await apiCall<PerspectiveSaveResponse>(
        `/api/perspectives/${encodeURIComponent(perspectiveTableId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (call.status === 404) {
        throw new Error(t('ui.dataTable.perspectives.error.apiUnavailable', 'Perspectives API is not available. Run `yarn generate` to regenerate module routes and restart the dev server.'))
      }
      if (!call.ok) {
        await raiseCrudError(call.response, t('ui.dataTable.perspectives.error.save', 'Failed to save perspective'))
      }
      const result = call.result
      if (!result) throw new Error(t('ui.dataTable.perspectives.error.save', 'Failed to save perspective'))
      return result
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
    if (typeof header === 'function') return normalizeLabel(column.id)
    return normalizeLabel(column.id)
  }, [])

  const activePersonalPerspectiveId = React.useMemo(() => {
    if (!perspectiveData || !activePerspectiveId) return null
    const found = perspectiveData.perspectives.find((p) => p.id === activePerspectiveId)
    return found ? found.id : null
  }, [perspectiveData, activePerspectiveId])


  const deletePerspectiveMutation = useMutation<void, Error, { perspectiveId: string }>({
    mutationFn: async ({ perspectiveId }) => {
      if (!perspectiveTableId) throw new Error('Missing table id')
      const call = await apiCall(
        `/api/perspectives/${encodeURIComponent(perspectiveTableId)}/${encodeURIComponent(perspectiveId)}`,
        { method: 'DELETE' },
      )
      if (call.status === 404) throw new Error(t('ui.dataTable.perspectives.error.apiUnavailable', 'Perspectives API is not available. Run `yarn generate` and restart the dev server.'))
      if (!call.ok) {
        await raiseCrudError(call.response, t('ui.dataTable.perspectives.error.delete', 'Failed to delete perspective'))
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
          writePerspectiveSnapshot(perspectiveTableId, null)
          initialSnapshotRef.current = null
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
      const call = await apiCall(
        `/api/perspectives/${encodeURIComponent(perspectiveTableId)}/roles/${encodeURIComponent(roleId)}`,
        { method: 'DELETE' },
      )
      if (call.status === 404) throw new Error(t('ui.dataTable.perspectives.error.apiUnavailable', 'Perspectives API is not available. Run `yarn generate` and restart the dev server.'))
      if (!call.ok) {
        await raiseCrudError(call.response, t('ui.dataTable.perspectives.error.clearRoles', 'Failed to clear role perspectives'))
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
          if (perspectiveTableId) writePerspectiveSnapshot(perspectiveTableId, null)
          initialSnapshotRef.current = null
          initialPerspectiveAppliedRef.current = false
        }
      }
    },
  })

  const handlePerspectiveActivate = React.useCallback((item: PerspectiveDto | RolePerspectiveDto, _source?: 'personal' | 'role') => {
    applyPerspectiveSettings(item.settings, item.id)
  }, [applyPerspectiveSettings])

  const handlePerspectiveSave = React.useCallback(async (input: { name: string; isDefault: boolean; applyToRoles: string[]; setRoleDefault: boolean; perspectiveId?: string | null; settings?: PerspectiveSettings }) => {
    const normalizedRoles = Array.from(new Set(input.applyToRoles))
    await savePerspectiveMutation.mutateAsync({
      name: input.name.trim(),
      isDefault: input.isDefault,
      applyToRoles: normalizedRoles,
      setRoleDefault: normalizedRoles.length > 0 ? input.setRoleDefault : false,
      perspectiveId: input.perspectiveId !== undefined ? input.perspectiveId : activePersonalPerspectiveId,
      settings: input.settings,
    })
  }, [savePerspectiveMutation, activePersonalPerspectiveId])

  const handlePerspectiveDelete = React.useCallback(async (perspectiveId: string) => {
    await deletePerspectiveMutation.mutateAsync({ perspectiveId })
  }, [deletePerspectiveMutation])

  const handleClearRole = React.useCallback(async (roleId: string) => {
    await clearRoleMutation.mutateAsync({ roleId })
  }, [clearRoleMutation])

  const handleColumnChooserToggle = React.useCallback((key: string) => {
    const column = table.getColumn(key)
    if (!column) return
    const nextVisible = !column.getIsVisible()
    if (nextVisible) {
      setColumnOrder((prev) => (prev.includes(key) ? prev : [...prev, key]))
    }
    setColumnVisibility((prev) => {
      const next = { ...prev }
      if (nextVisible) delete next[key]
      else next[key] = false
      return next
    })
    column.toggleVisibility(nextVisible)
  }, [table])

  const handleColumnChooserReorder = React.useCallback((newOrder: string[]) => {
    setColumnOrder(newOrder)
    table.setColumnOrder(newOrder)
  }, [table])

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const enableHeaderDnd = Boolean(columnChooser)
  const stableDndContextId = React.useMemo(
    () => sanitizeDndContextId(
      extensionTableId
        ?? perspectiveTableId
        ?? resolvedReplacementHandle
        ?? (typeof title === 'string' && title.trim().length > 0 ? title : 'data-table'),
    ),
    [extensionTableId, perspectiveTableId, resolvedReplacementHandle, title],
  )
  const headerColumnIds = React.useMemo(() => {
    if (!enableHeaderDnd) return []
    return table.getHeaderGroups().flatMap((hg) => hg.headers.map((h) => h.id))
  }, [enableHeaderDnd, table, columnOrder])

  const handleHeaderDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const currentIds = columnOrder.length ? columnOrder : table.getAllLeafColumns().map((c) => c.id)
    const oldIdx = currentIds.indexOf(String(active.id))
    const newIdx = currentIds.indexOf(String(over.id))
    if (oldIdx === -1 || newIdx === -1) return
    const next = [...currentIds]
    const [moved] = next.splice(oldIdx, 1)
    next.splice(newIdx, 0, moved)
    setColumnOrder(next)
    table.setColumnOrder(next)
  }, [columnOrder, table])

  const perspectiveApiWarning = perspectiveApiMissing && canUsePerspectives
    ? t('ui.dataTable.perspectives.warning.apiUnavailable', 'Perspectives API is not available yet. Run `yarn generate` to regenerate module routes, then restart the server.')
    : null

  const loadStartRef = React.useRef<number | null>(null)
  const [measuredDurationMs, setMeasuredDurationMs] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (typeof isLoading !== 'boolean') return
    if (isLoading) {
      if (loadStartRef.current === null) {
        const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
        loadStartRef.current = now
      }
      return
    }
    if (loadStartRef.current !== null) {
      const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
      setMeasuredDurationMs(now - loadStartRef.current)
      loadStartRef.current = null
    }
  }, [isLoading])

  React.useLayoutEffect(() => {
    if (!canUsePerspectives) return
    if (!perspectiveTableId) return
    if (initialSnapshotRef.current) return
    if (initialPerspectiveAppliedRef.current && activePerspectiveId != null) return

    const source = perspectiveData ?? perspectiveConfig?.initialState?.response
    if (!source) return

    const tryResolve = (id: string | null | undefined): PerspectiveDto | RolePerspectiveDto | undefined => {
      if (!id) return undefined
      return source.perspectives.find((p) => p.id === id)
        ?? source.rolePerspectives.find((p) => p.id === id)
    }

    let target: PerspectiveDto | RolePerspectiveDto | undefined
    if (activePerspectiveId) {
      target = tryResolve(activePerspectiveId)
    }
    const cookieId = readPerspectiveCookie(perspectiveTableId)
    if (!target && cookieId) target = tryResolve(cookieId)
    if (!target && source.defaultPerspectiveId) {
      target = tryResolve(source.defaultPerspectiveId)
    }
    if (!target) {
      target = source.rolePerspectives.find((p) => p.isDefault)
    }
    if (!target) {
      target = source.perspectives[0]
    }
    if (target) {
      applyPerspectiveSettings(target.settings, target.id)
    }
    initialPerspectiveAppliedRef.current = true
  }, [canUsePerspectives, perspectiveData, perspectiveTableId, perspectiveConfig, applyPerspectiveSettings, activePerspectiveId])

  const scrollTableIntoView = React.useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.top >= 0) return
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    containerRef.current?.scrollIntoView({ behavior, block: 'start' })
  }, [])

  const paginationNode = React.useMemo(() => {
    if (!pagination || pagination.total === 0) return null

    const { page, totalPages, onPageChange, durationMs, cacheStatus } = pagination
    const startItem = (page - 1) * pagination.pageSize + 1
    const endItem = Math.min(page * pagination.pageSize, pagination.total)
    const effectiveDuration = (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0)
      ? durationMs
      : measuredDurationMs ?? undefined
    const durationLabel = formatDurationLabel(effectiveDuration)
    const normalizedCacheStatus = cacheStatus === 'hit' || cacheStatus === 'miss' ? cacheStatus : null
    const cacheBadge = normalizedCacheStatus ? (
      <span
        className="inline-flex items-center justify-center"
        aria-label={t('ui.dataTable.pagination.cache.ariaLabel', 'Cache {status}', { status: normalizedCacheStatus.toUpperCase() })}
        title={t('ui.dataTable.pagination.cache.title', 'Cache {status}', { status: normalizedCacheStatus.toUpperCase() })}
      >
        <Circle
          className={`h-3.5 w-3.5 ${normalizedCacheStatus === 'hit' ? 'text-emerald-500' : 'text-amber-500'}`}
          strokeWidth={3}
        />
        <span className="sr-only">{t('ui.dataTable.pagination.cache.srOnly', 'Cache {status}', { status: normalizedCacheStatus.toUpperCase() })}</span>
      </span>
    ) : null

    const pageSizeOptions = Array.isArray(pagination.pageSizeOptions)
      ? Array.from(new Set(
          [pagination.pageSize, ...pagination.pageSizeOptions]
            .filter((size): size is number => typeof size === 'number' && Number.isFinite(size) && size > 0)
            .map((size) => Math.max(1, Math.floor(size))),
        )).sort((left, right) => left - right)
      : []
    const pageSizeSelect = pageSizeOptions.length > 0 && pagination.onPageSizeChange ? (
      <span className="inline-flex items-center gap-1.5">
        <Select
          value={String(pagination.pageSize)}
          onValueChange={(value) => {
            pagination.onPageSizeChange!(Number(value))
            scrollTableIntoView()
          }}
        >
          <SelectTrigger
            size="sm"
            className="min-w-[4rem]"
            aria-label={t('ui.dataTable.pagination.rowsPerPage', 'Rows per page')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">{t('ui.dataTable.pagination.perPage', 'per page')}</span>
      </span>
    ) : null

    return (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t">
        <div className="text-sm text-muted-foreground flex items-center justify-center sm:justify-start gap-2 flex-wrap">
          <span>
            {durationLabel
              ? t('ui.dataTable.pagination.resultsWithDuration', 'Showing {start} to {end} of {total} results in {duration}', { start: startItem, end: endItem, total: pagination.total, duration: durationLabel })
              : t('ui.dataTable.pagination.results', 'Showing {start} to {end} of {total} results', { start: startItem, end: endItem, total: pagination.total })
            }
          </span>
          {cacheBadge}
          {pageSizeSelect}
        </div>
        <div className="flex items-center justify-center sm:justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onPageChange(page - 1); scrollTableIntoView() }}
            disabled={page <= 1}
          >
            {t('ui.dataTable.pagination.previous', 'Previous')}
          </Button>
          <span className="text-sm whitespace-nowrap">
            {t('ui.dataTable.pagination.pageInfo', 'Page {page} of {totalPages}', { page, totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { onPageChange(page + 1); scrollTableIntoView() }}
            disabled={page >= totalPages}
          >
            {t('ui.dataTable.pagination.next', 'Next')}
          </Button>
        </div>
      </div>
    )
  }, [pagination, measuredDurationMs, scrollTableIntoView, t])

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
  const customFieldFilterExtrasSignature = React.useMemo(
    () => JSON.stringify(customFieldFilterKeyExtras ?? []),
    [customFieldFilterKeyExtras]
  )

  const [cfFilterFieldsetsByEntity, setCfFilterFieldsetsByEntity] = React.useState<Record<string, CustomFieldsetDto[]>>({})
  const [cfFilterFieldsetSelection, setCfFilterFieldsetSelection] = React.useState<Record<string, string | null>>({})

  React.useEffect(() => {
    if (!entityKey) {
      setCfFilterFieldsetsByEntity({})
      setCfFilterFieldsetSelection({})
      return
    }
    let cancelled = false
    const loadFieldsets = async () => {
      try {
        const payload = await fetchCustomFieldDefinitionsPayload(resolvedEntityIds)
        if (cancelled) return
        const fieldsets = payload.fieldsetsByEntity ?? {}
        setCfFilterFieldsetsByEntity(fieldsets)
        const selectionChanges: Array<[string, string | null]> = []
        let shouldNotify = false
        setCfFilterFieldsetSelection((prev) => {
          const next: Record<string, string | null> = {}
          let changed = false
          resolvedEntityIds.forEach((entityId) => {
            const list = fieldsets[entityId] ?? []
            if (!list.length) {
              if (prev[entityId] !== undefined) changed = true
              return
            }
            const existing = prev[entityId]
            const fallback = list[0]?.code ?? null
            const isValidExisting = existing ? list.some((entry) => entry.code === existing) : false
            const value = isValidExisting ? existing : fallback ?? null
            next[entityId] = value
            if (value !== existing) {
              changed = true
              selectionChanges.push([entityId, value])
            }
          })
          if (Object.keys(prev).length !== Object.keys(next).length) changed = true
          if (changed) {
            shouldNotify = true
            return next
          }
          return prev
        })
        if (shouldNotify && selectionChanges.length && onCustomFieldFilterFieldsetChange) {
          selectionChanges.forEach(([entityId, value]) => onCustomFieldFilterFieldsetChange(value, entityId))
        }
      } catch {
        if (!cancelled) {
          setCfFilterFieldsetsByEntity({})
          setCfFilterFieldsetSelection({})
        }
      }
    }
    loadFieldsets()
    return () => {
      cancelled = true
    }
  }, [customFieldFilterExtrasSignature, entityKey, onCustomFieldFilterFieldsetChange, resolvedEntityIds])

  const supportsCustomFieldFilterFieldsets =
    resolvedEntityIds.length === 1 &&
    (cfFilterFieldsetsByEntity[resolvedEntityIds[0]]?.length ?? 0) > 0
  const activeCustomFieldFilterFieldset = supportsCustomFieldFilterFieldsets
    ? cfFilterFieldsetSelection[resolvedEntityIds[0]] ?? cfFilterFieldsetsByEntity[resolvedEntityIds[0]]?.[0]?.code ?? null
    : null

  const handleCustomFieldFilterFieldsetChange = React.useCallback(
    (value: string) => {
      if (!supportsCustomFieldFilterFieldsets) return
      const entityId = resolvedEntityIds[0]
      const nextValue = value || null
      setCfFilterFieldsetSelection((prev) => {
        if (prev[entityId] === nextValue) return prev
        return { ...prev, [entityId]: nextValue }
      })
      if (onCustomFieldFilterFieldsetChange) {
        onCustomFieldFilterFieldsetChange(nextValue, entityId)
      }
    },
    [onCustomFieldFilterFieldsetChange, resolvedEntityIds, supportsCustomFieldFilterFieldsets],
  )

  const { data: cfFilters = [] } = useCustomFieldFilterDefs(entityKey ? resolvedEntityIds : [], {
    enabled: !!entityKey,
    fieldset: supportsCustomFieldFilterFieldsets ? activeCustomFieldFilterFieldset ?? undefined : undefined,
    keyExtras: customFieldFilterKeyExtras,
  })

  const isAutoAdvancedFilter = Boolean(advancedFilter?.auto)
  const isAutoColumnChooser = Boolean(columnChooser?.auto)
  const needsAutoDiscovery = isAutoAdvancedFilter || isAutoColumnChooser
  const { data: autoDiscoveryDefs = [] } = useCustomFieldDefs(
    needsAutoDiscovery && entityKey ? resolvedEntityIds : [],
    { enabled: needsAutoDiscovery && !!entityKey },
  )
  const autoDiscovered = useAutoDiscoveredFields({
    columns: needsAutoDiscovery ? mergedColumns : [],
    customFieldDefs: needsAutoDiscovery ? autoDiscoveryDefs : [],
  })
  const resolvedAdvancedFilterFields = isAutoAdvancedFilter
    ? autoDiscovered.advancedFilterFields
    : advancedFilter?.fields ?? []

  const advancedFilterRuleCount = React.useMemo<number>(() => {
    if (!advancedFilter) return 0
    function countRules(group: AdvancedFilterTree['root']): number {
      let n = 0
      for (const c of group.children) {
        if (c.type === 'rule') n += 1
        else n += countRules(c)
      }
      return n
    }
    return countRules(advancedFilter.value.root)
  }, [advancedFilter])
  const resolvedColumnChooserFields = isAutoColumnChooser
    ? autoDiscovered.columnChooserFields
    : columnChooser?.availableColumns ?? []

  const effectiveColumnChooserFields = React.useMemo<ColumnChooserField[]>(() => {
    if (resolvedColumnChooserFields.length > 0) return resolvedColumnChooserFields
    return table.getAllLeafColumns().map((col) => ({
      key: col.id,
      label: resolveColumnLabel(col),
      group: 'Columns',
      alwaysVisible: !col.getCanHide(),
    }))
  }, [resolvedColumnChooserFields, table, resolveColumnLabel, columns])

  const visibleColumnKeys = React.useMemo(
    () => table.getAllLeafColumns().filter((c) => c.getIsVisible()).map((c) => c.id),
    [table, columnVisibility, columns],
  )

  const selectedRows = React.useMemo<T[]>(() => {
    if (!hasInjectedBulkActions) return []
    return table.getSelectedRowModel().rows.map((row) => row.original as T)
  }, [hasInjectedBulkActions, table, rowSelection])
  const trackedBulkProgressJobIdsRef = React.useRef(new Set<string>())

  const clearTrackedBulkProgressJob = React.useCallback((jobId: string | null): boolean => {
    if (!jobId) return false
    return trackedBulkProgressJobIdsRef.current.delete(jobId)
  }, [])

  const refreshAfterBulkProgressCompletion = React.useCallback(() => {
    if (refreshButton?.onRefresh) {
      refreshButton.onRefresh()
      return
    }
    scheduleRouterRefresh(router)
  }, [refreshButton, router])

  useAppEvent(
    'progress.job.completed',
    (event) => {
      const payload = event.payload as { jobId?: unknown } | null | undefined
      const jobId = typeof payload?.jobId === 'string' ? payload.jobId : null
      if (!clearTrackedBulkProgressJob(jobId)) return
      refreshAfterBulkProgressCompletion()
    },
    [clearTrackedBulkProgressJob, refreshAfterBulkProgressCompletion],
  )

  useAppEvent(
    'progress.job.failed',
    (event) => {
      const payload = event.payload as { jobId?: unknown } | null | undefined
      const jobId = typeof payload?.jobId === 'string' ? payload.jobId : null
      clearTrackedBulkProgressJob(jobId)
    },
    [clearTrackedBulkProgressJob],
  )

  useAppEvent(
    'progress.job.cancelled',
    (event) => {
      const payload = event.payload as { jobId?: unknown } | null | undefined
      const jobId = typeof payload?.jobId === 'string' ? payload.jobId : null
      clearTrackedBulkProgressJob(jobId)
    },
    [clearTrackedBulkProgressJob],
  )

  const runBulkAction = React.useCallback(
    async (action: InjectionBulkActionDefinition) => {
      if (action.requiresSelection !== false && !selectedRows.length) return
      try {
        const result = await action.onExecute(selectedRows, {
          tableId: extensionTableId,
          navigate: (href: string) => router.push(href),
          confirm,
          refresh: refreshButton?.onRefresh,
          injectionContext: resolvedInjectionContext,
          translate: t,
        })
        const normalized = result as BulkActionExecuteResult | void
        if (normalized && normalized.ok === false) {
          if (normalized.message === undefined) return
          flash(
            normalized.message
              ?? t('ui.dataTable.bulkAction.error', 'Bulk action failed.'),
            'error',
          )
          return
        }
        if (normalized?.progressJobId) {
          trackedBulkProgressJobIdsRef.current.add(normalized.progressJobId)
          setRowSelection({})
          flash(
            normalized.message
              ?? t('ui.dataTable.bulkAction.started', 'Bulk action started. Track progress in the top bar.'),
            'success',
          )
          return
        }
        flash(
          normalized?.message
            ?? t('ui.dataTable.bulkAction.success', 'Bulk action completed.'),
          'success',
        )
        setRowSelection({})
        if (refreshButton?.onRefresh) {
          refreshButton.onRefresh()
        } else {
          scheduleRouterRefresh(router)
        }
      } catch (error) {
        flash(
          error instanceof Error
            ? error.message
            : t('ui.dataTable.bulkAction.error', 'Bulk action failed.'),
          'error',
        )
      }
    },
    [confirm, extensionTableId, refreshButton, resolvedInjectionContext, router, selectedRows, t],
  )

  const runPropBulkAction = React.useCallback(
    async (action: BulkAction<T>) => {
      const result = await action.onExecute(selectedRows)
      if (result !== false) {
        setRowSelection({})
      }
    },
    [selectedRows],
  )

  const builtToolbar = React.useMemo(() => {
    if (toolbar) return toolbar
    const anySearch = onSearchChange != null
    const anyFilters = (baseFilters && baseFilters.length > 0) || (cfFilters && cfFilters.length > 0) || injectedFilters.length > 0
    const hasBulkButtons = hasInjectedBulkActions || hasPropBulkActions
    if (!anySearch && !anyFilters && !hasBulkButtons) return null
    // Merge base filters with CF filters, preferring base definitions when ids collide
    const baseList = baseFilters || []
    const existing = new Set(baseList.map((f) => f.id))
    const cfOnly = (cfFilters || []).filter((f) => !existing.has(f.id))
    const injectedOnly = injectedFilters.filter((f) => !existing.has(f.id) && !cfOnly.some((cf) => cf.id === f.id))
    const combined: FilterDef[] = [...baseList, ...cfOnly, ...injectedOnly]
    const perspectiveButton = canUsePerspectives ? (
      <ViewSwitcherDropdown
        activePerspectiveId={activePerspectiveId}
        perspectives={perspectiveData?.perspectives ?? []}
        rolePerspectives={perspectiveData?.rolePerspectives ?? []}
        onClear={() => applyPerspectiveSettings({}, null)}
        onActivate={handlePerspectiveActivate}
        onOpenSidebar={() => setPerspectiveOpen(true)}
        t={t}
      />
    ) : null
    const fieldsetSelector =
      supportsCustomFieldFilterFieldsets && resolvedEntityIds.length === 1
        ? (
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('ui.dataTable.fieldset.label', 'Fieldset')}
            </div>
            <Select
              value={activeCustomFieldFilterFieldset || undefined}
              onValueChange={(value) => handleCustomFieldFilterFieldsetChange(value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(cfFilterFieldsetsByEntity[resolvedEntityIds[0]] ?? []).map((fieldset) => (
                  <SelectItem key={fieldset.code} value={fieldset.code}>
                    {fieldset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
        : null
    const leadingItems = perspectiveButton ? <div className="flex items-center gap-2">{perspectiveButton}</div> : null
    const trailingItems = hasBulkButtons ? (
      <div className="flex flex-wrap items-center gap-2">
        {selectedRows.length > 0 ? (
          <span className="text-sm text-muted-foreground">
            {t('ui.dataTable.bulkAction.selectedCount', '{count} selected', { count: selectedRows.length })}
          </span>
        ) : null}
        {injectedBulkActions.map((action) => {
          const label = t(action.label, action.label)
          const iconNode = resolveInjectedIcon(action.icon, 'h-4 w-4 shrink-0')
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              title={label}
              aria-label={label}
              className={iconNode ? 'px-2 sm:px-3' : undefined}
              disabled={action.requiresSelection !== false && selectedRows.length === 0}
              onClick={() => void runBulkAction(action)}
            >
              {iconNode}
              <span className={iconNode ? 'hidden sm:inline' : undefined}>{label}</span>
            </Button>
          )
        })}
        {selectedRows.length > 0 ? (bulkActionsProp ?? []).map((action) => {
          const ActionIcon = action.icon
          return (
            <Button
              key={action.id}
              type="button"
              variant={action.destructive ? 'destructive' : 'outline'}
              onClick={() => void runPropBulkAction(action)}
            >
              {ActionIcon ? <ActionIcon className="h-4 w-4 shrink-0" /> : null}
              <span>{action.label}</span>
            </Button>
          )
        }) : null}
      </div>
    ) : null
    const searchTrailingNode = searchTrailingInjectionSpotId && onSearchChange ? (
      <InjectionSpot spotId={searchTrailingInjectionSpotId} context={resolvedInjectionContext} />
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
        leadingItems={leadingItems}
        trailingItems={trailingItems}
        searchTrailing={searchTrailingNode}
        filtersExtraContent={fieldsetSelector}
        layout={embedded ? 'inline' : 'stacked'}
        className={embedded ? 'min-h-[2.25rem]' : undefined}
      />
    )
  }, [
    toolbar,
    searchValue,
    onSearchChange,
    searchPlaceholder,
    searchAlign,
    baseFilters,
    cfFilters,
    injectedFilters,
    filterValues,
    onFiltersApply,
    onFiltersClear,
    canUsePerspectives,
    embedded,
    supportsCustomFieldFilterFieldsets,
    resolvedEntityIds,
    activeCustomFieldFilterFieldset,
    handleCustomFieldFilterFieldsetChange,
    cfFilterFieldsetsByEntity,
    hasInjectedBulkActions,
    hasPropBulkActions,
    injectedBulkActions,
    bulkActionsProp,
    selectedRows.length,
    selectedRows,
    runBulkAction,
    runPropBulkAction,
    searchTrailingInjectionSpotId,
    resolvedInjectionContext,
  ])

  const hasTitle = title != null
  const hasActions = actions !== undefined && actions !== null && actions !== false
  const shouldReserveActionsSpace = actions === null || actions === false
  const exportConfig = exporter === false ? null : exporter || null
  const resolvedExportSections = React.useMemo(() => resolveExportSections(exportConfig), [exportConfig])
  const hasExport = resolvedExportSections.length > 0
  const refreshButtonConfig = refreshButton
  const hasRefreshButton = Boolean(refreshButtonConfig)
  const hasToolbar = builtToolbar != null
  const hasToolbarInjection = Boolean(toolbarInjectionSpotId)
  const shouldRenderActionsWrapper = hasActions || hasRefreshButton || shouldReserveActionsSpace || hasExport || hasToolbarInjection || Boolean(advancedFilter)
  const renderToolbarInline = embedded && hasToolbar
  const shouldRenderToolbarBelow = hasToolbar && !renderToolbarInline
  const shouldRenderHeader = hasTitle || renderToolbarInline || shouldRenderActionsWrapper || shouldRenderToolbarBelow
  const containerClassName = embedded ? '' : 'rounded-lg border bg-card mx-1 sm:mx-2'
  const headerWrapperClassName = embedded ? 'pb-3' : 'px-4 py-3 border-b'
  const headerContentClassName = 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'
  const toolbarWrapperClassName = embedded ? 'mt-2' : 'mt-3 pt-3 border-t'
  const tableScrollWrapperClassName = embedded ? '' : 'overflow-auto'

  const virtualScrollRef = React.useRef<HTMLDivElement>(null)
  const allRows = table.getRowModel().rows
  const rowVirtualizer = virtualized
    ? useVirtualizer({
        count: allRows.length,
        getScrollElement: () => virtualScrollRef.current,
        estimateSize: () => 48,
        overscan: virtualizedOverscan,
      })
    : null
  const virtualMaxHeightStyle: React.CSSProperties | undefined = virtualized
    ? {
        maxHeight: typeof virtualizedMaxHeight === 'number'
          ? `${virtualizedMaxHeight}px`
          : virtualizedMaxHeight ?? 'calc(100vh - 300px)',
        overflow: 'auto',
      }
    : undefined

  const titleContent = hasTitle ? (
    <div className="text-base font-semibold leading-tight min-h-[2.25rem] flex items-center">
      {typeof title === 'string' ? <h2 className="text-base font-semibold">{title}</h2> : title}
    </div>
  ) : <div className="min-h-[2.25rem]" />

  return (
    <TooltipProvider delayDuration={300}>
    <div ref={containerRef} className={containerClassName} data-component-handle={resolvedReplacementHandle}>
      {shouldRenderHeader && (
        <div className={headerWrapperClassName}>
          {(hasTitle || shouldRenderActionsWrapper || renderToolbarInline) && (
            <div className={headerContentClassName}>
              <div className="flex-1 min-w-0">
                {renderToolbarInline ? builtToolbar : titleContent}
              </div>
              {shouldRenderActionsWrapper ? (
                <div className="flex flex-wrap items-center gap-2 min-h-[2.25rem]">
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
                  {advancedFilter ? (
                    <Button
                      type="button"
                      variant={advancedFilterRuleCount > 0 ? 'secondary' : 'ghost'}
                      size="icon"
                      onClick={() => {
                        const opening = !isAdvancedFilterOpen
                        if (opening && advancedFilterRuleCount === 0) {
                          const defaultField = resolvedAdvancedFilterFields[0]
                          const seeded = treeReducer(advancedFilter.value, {
                            type: 'addRule',
                            groupId: advancedFilter.value.root.id,
                            defaultField: defaultField?.key,
                          })
                          // Patch operator default for the seeded rule's field type
                          if (defaultField) {
                            const newRule = seeded.root.children[seeded.root.children.length - 1]
                            if (newRule && newRule.type === 'rule') {
                              newRule.operator = getDefaultOperator(defaultField.type)
                            }
                          }
                          advancedFilter.onChange(seeded)
                        }
                        setAdvancedFilterOpen(opening)
                      }}
                      aria-label={t('ui.advancedFilter.toggle', 'Advanced filters')}
                      title={t('ui.advancedFilter.toggle', 'Advanced filters')}
                    >
                      <Filter className="h-4 w-4" />
                      {advancedFilterRuleCount > 0 ? (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-overline text-primary-foreground">
                          {advancedFilterRuleCount}
                        </span>
                      ) : null}
                    </Button>
                  ) : null}
                  {canUsePerspectives ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPerspectiveOpen(true)}
                      aria-label={t('ui.dataTable.customizeColumns.ariaLabel', 'Customize columns')}
                      title={t('ui.dataTable.customizeColumns.title', 'Customize columns')}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">{t('ui.dataTable.customizeColumns.srOnly', 'Customize columns')}</span>
                    </Button>
                  ) : null}
                  {exportConfig && hasExport ? <ExportMenu config={exportConfig} sections={resolvedExportSections} /> : null}
                  {toolbarInjectionSpotId ? (
                    <InjectionSpot spotId={toolbarInjectionSpotId} context={resolvedInjectionContext} />
                  ) : null}
                  {hasActions ? actions : null}
                </div>
              ) : null}
            </div>
          )}
          {shouldRenderToolbarBelow ? <div className={toolbarWrapperClassName}>{builtToolbar}</div> : null}
          {headerInjectionSpotId ? (
            <div className={embedded ? 'mt-2' : 'mt-3'}>
              <InjectionSpot spotId={headerInjectionSpotId} context={resolvedInjectionContext} />
            </div>
          ) : null}
        </div>
      )}
      {advancedFilter && isAdvancedFilterOpen ? (
        <div className="border-b">
          <AdvancedFilterBuilder
            fields={resolvedAdvancedFilterFields}
            value={advancedFilter.value}
            onChange={advancedFilter.onChange}
            onApply={() => { advancedFilter.onApply(); setAdvancedFilterOpen(false) }}
            onClear={() => { advancedFilter.onClear(); setAdvancedFilterOpen(false) }}
          />
        </div>
      ) : null}
      {advancedFilter && advancedFilterRuleCount > 0 && !isAdvancedFilterOpen ? (
        <div className="flex items-center gap-2 flex-wrap px-4 py-2 border-b text-sm">
          <span className="text-muted-foreground">
            {t('ui.advancedFilter.activeCount', '{count} active filters', { count: advancedFilterRuleCount })}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs" onClick={() => setAdvancedFilterOpen(true)}>
            {t('ui.advancedFilter.edit', 'Edit')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-xs text-muted-foreground" onClick={advancedFilter.onClear}>
            {t('ui.advancedFilter.clearAll', 'Clear all')}
          </Button>
        </div>
      ) : null}
      <HeaderDndWrapper
        enabled={enableHeaderDnd}
        contextId={`${stableDndContextId}-headers`}
        sensors={dndSensors}
        columnIds={headerColumnIds}
        onDragEnd={handleHeaderDragEnd}
      >
      <div ref={virtualized ? virtualScrollRef : undefined} className={tableScrollWrapperClassName} style={virtualMaxHeightStyle}>
        <Table className="min-w-[640px] md:min-w-0">
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hasInjectedBulkActions ? (
                  <TableHead className="w-8">
                    <Checkbox
                      checked={table.getIsAllPageRowsSelected()}
                      onCheckedChange={(checked) => {
                        table.toggleAllPageRowsSelected(Boolean(checked))
                      }}
                      aria-label={t('ui.dataTable.bulkAction.selectAll', 'Select all rows')}
                    />
                  </TableHead>
                ) : null}
                {hg.headers.map((header, headerIndex) => {
                  const columnMeta = (header.column.columnDef as any)?.meta
                  const priority = resolvePriority(header.column)
                  const isFirstDataColumn = headerIndex === 0
                  const stickyClass = stickyFirstColumn && isFirstDataColumn ? ' sticky left-0 z-10 bg-background' : ''
                  const headerCellContent = header.isPlaceholder ? null : (
                    <Button
                      variant="ghost"
                      type="button"
                      className={`h-auto p-0 font-medium ${sortable && header.column.getCanSort?.() ? 'cursor-pointer select-none' : ''}`}
                      onClick={() => sortable && header.column.toggleSorting?.(header.column.getIsSorted() === 'asc')}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortable && header.column.getCanSort?.() ? (
                        (() => {
                          const sortState = header.column.getIsSorted()
                          if (sortState === 'asc') return <ChevronUp className="ml-1 size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                          if (sortState === 'desc') return <ChevronDown className="ml-1 size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                          return <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                        })()
                      ) : null}
                    </Button>
                  )
                  return enableHeaderDnd ? (
                    <SortableHeaderCell key={header.id} id={header.id} className={responsiveClass(priority, columnMeta?.hidden) + stickyClass}>
                      {headerCellContent}
                    </SortableHeaderCell>
                  ) : (
                    <TableHead key={header.id} className={responsiveClass(priority, columnMeta?.hidden) + stickyClass}>
                      {headerCellContent}
                    </TableHead>
                  )
                })}
                {rowActions || injectedRowActions.length > 0 ? (
                  <TableHead
                    className={cn(
                      'w-0 text-right',
                      stickyActionsColumn && 'sticky right-0 z-20 bg-background',
                    )}
                  >
                    {t('ui.dataTable.actionsColumn', 'Actions')}
                  </TableHead>
                ) : null}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={mergedColumns.length + (rowActions || injectedRowActions.length > 0 ? 1 : 0) + (hasInjectedBulkActions ? 1 : 0)} className="h-24 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Spinner size="md" />
                    <span className="text-muted-foreground">{t('ui.dataTable.loading', 'Loading data...')}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={mergedColumns.length + (rowActions || injectedRowActions.length > 0 ? 1 : 0) + (hasInjectedBulkActions ? 1 : 0)} className="h-24 text-center text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : allRows.length ? (
              <>
              {virtualized && rowVirtualizer ? (
                <>
                  {rowVirtualizer.getVirtualItems()[0]?.start > 0 ? (
                    <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }} />
                  ) : null}
                </>
              ) : null}
              {(virtualized && rowVirtualizer
                ? rowVirtualizer.getVirtualItems().map((vi) => allRows[vi.index])
                : allRows
              ).map((row) => {
                const rowActionsElement = resolvedRowActions(row.original as T)
                const defaultRowAction = onRowClick ? null : pickDefaultRowAction(rowActionsElement, resolvedRowClickActionIds)
                const isClickable = !disableRowClick && (onRowClick || defaultRowAction)
                
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
                      } else if (defaultRowAction) {
                        if (defaultRowAction.href) {
                          router.push(defaultRowAction.href)
                        } else if (defaultRowAction.onSelect) {
                          defaultRowAction.onSelect()
                        }
                      }
                    } : undefined}
                  >
                    {hasInjectedBulkActions ? (
                      <TableCell className="w-8">
                        <Checkbox
                          checked={row.getIsSelected()}
                          onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                          aria-label={t('ui.dataTable.bulkAction.selectRow', 'Select row')}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </TableCell>
                    ) : null}
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const columnMeta = (cell.column.columnDef as any)?.meta
                      const priority = resolvePriority(cell.column)
                      const isStickyCell = stickyFirstColumn && cellIndex === 0
                      const hasCustomCell = Boolean(cell.column.columnDef.cell)
                      const columnId = String((cell.column as any).id || '')
                      const accessorKey = String((cell.column.columnDef as any)?.accessorKey || '')
                      const isDateCol = dateColumnIds ? dateColumnIds.has(columnId) : false

                      let content: React.ReactNode
                      if (isDateCol) {
                        const raw = cell.getValue() as any
                        const d = tryParseDate(raw)
                        content = d ? simpleFormat(d, DATE_FORMAT) : (raw as any)
                      } else {
                        content = flexRender(cell.column.columnDef.cell, cell.getContext())
                      }

                      // Get truncation configuration for this column
                      const skipTruncation = shouldSkipTruncation(columnId)
                      // Get truncation configuration for this column
                      const truncateConfig = getColumnTruncateConfig(columnId, accessorKey, columnMeta)
                      const shouldTruncate = truncateConfig.truncate && !skipTruncation
                      const maxWidth = truncateConfig.maxWidth

                      // Wrap content with TruncatedCell if truncation is enabled
                      // Get raw cell value for tooltip - flexRender returns React elements
                      // that cannot have their text extracted, so we pass the raw value directly
                      // Check for custom tooltip content function in column meta for complex cells
                      const cellValue = cell.getValue()
                      const metaTooltipContent = columnMeta?.tooltipContent as ((row: unknown) => string | undefined) | undefined
                      let tooltipText: string | undefined
                      if (metaTooltipContent) {
                        tooltipText = metaTooltipContent(row.original)
                      } else if (isDateCol && cellValue != null) {
                        const parsedDate = tryParseDate(cellValue)
                        tooltipText = parsedDate ? simpleFormat(parsedDate, DATE_FORMAT) : String(cellValue)
                      } else {
                        tooltipText = cellValue != null ? String(cellValue) : undefined
                      }

                      const wrappedContent = shouldTruncate ? (
                        <TruncatedCell maxWidth={maxWidth} tooltipContent={tooltipText}>
                          {content}
                        </TruncatedCell>
                      ) : content

                      return (
                        <TableCell key={cell.id} className={responsiveClass(priority, columnMeta?.hidden) + (isStickyCell ? ' sticky left-0 z-10 bg-background' : '')}>
                          {wrappedContent}
                        </TableCell>
                      )
                    })}
                    {rowActions || injectedRowActions.length > 0 ? (
                      <TableCell
                        className={cn(
                          'text-right whitespace-nowrap',
                          stickyActionsColumn && 'sticky right-0 z-10 bg-background',
                        )}
                        data-actions-cell
                      >
                        {rowActionsElement}
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })}
              {virtualized && rowVirtualizer ? (() => {
                const virtualItems = rowVirtualizer.getVirtualItems()
                const lastItem = virtualItems[virtualItems.length - 1]
                const bottomPadding = lastItem ? rowVirtualizer.getTotalSize() - lastItem.end : 0
                return bottomPadding > 0 ? <tr style={{ height: `${bottomPadding}px` }} /> : null
              })() : null}
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={mergedColumns.length + (rowActions || injectedRowActions.length > 0 ? 1 : 0) + (hasInjectedBulkActions ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                  {emptyState ?? t('ui.dataTable.emptyState.default', 'No results.')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      </HeaderDndWrapper>
      {footerInjectionSpotId ? (
        <div className={embedded ? 'mt-3' : 'px-4 py-3 border-t'}>
          <InjectionSpot spotId={footerInjectionSpotId} context={resolvedInjectionContext} />
        </div>
      ) : null}
      {paginationNode}
      {ConfirmDialogElement}
      {canUsePerspectives ? (
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
          canApplyToRoles={Boolean(perspectiveData?.canApplyToRoles && canUseRoleDefaultsFeature)}
          availableColumns={effectiveColumnChooserFields}
          visibleColumnKeys={visibleColumnKeys}
          columnOrder={columnOrder}
          onToggleColumn={handleColumnChooserToggle}
          onReorderColumns={handleColumnChooserReorder}
          saving={savePerspectiveMutation.isPending}
          deletingIds={deletingIds}
          roleClearingIds={roleClearingIds}
          apiWarning={perspectiveApiWarning}
        />
      ) : null}
    </div>
    </TooltipProvider>
  )
}
