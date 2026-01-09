'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DynamicTable,
  TableEvents,
  dispatch,
  useEventHandlers,
  ColumnsPopover,
  type ColumnDef,
  type CellEditSaveEvent,
  type PerspectiveConfig,
  type PerspectiveSelectEvent,
  type PerspectiveSaveEvent,
  type PerspectiveDeleteEvent,
  type PerspectiveRenameEvent,
  type SortRule,
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type {
  PerspectiveDto,
  PerspectiveSettings,
  PerspectivesIndexResponse,
} from '@open-mercato/shared/modules/perspectives/types'
import {
  FMS_QUOTE_STATUSES,
  FMS_DIRECTIONS,
  FMS_INCOTERMS,
  FMS_CARGO_TYPES,
  type FmsQuoteStatus,
} from '../data/types'

const TABLE_ID = 'fms-quote-details'

// Transform API perspective format to DynamicTable format
function apiToDynamicTable(dto: PerspectiveDto, allColumns: string[]): PerspectiveConfig {
  const { columnOrder = [], columnVisibility = {} } = dto.settings

  const visible = columnOrder.length > 0
    ? columnOrder.filter(col => columnVisibility[col] !== false)
    : allColumns
  const hidden = allColumns.filter(col => !visible.includes(col))

  const apiFilters = dto.settings.filters as Record<string, unknown> | undefined
  const filters = Array.isArray(apiFilters)
    ? apiFilters
    : (apiFilters?.rows as Array<{ id: string; field: string; operator: string; values: unknown[] }>) ?? []
  const color = apiFilters?._color as PerspectiveConfig['color']

  const sorting: SortRule[] = (dto.settings.sorting ?? []).map(s => ({
    id: s.id,
    field: s.id,
    direction: (s.desc ? 'desc' : 'asc') as 'asc' | 'desc'
  }))

  return { id: dto.id, name: dto.name, color, columns: { visible, hidden }, filters, sorting }
}

// Transform DynamicTable perspective format to API format
function dynamicTableToApi(config: PerspectiveConfig): PerspectiveSettings {
  const columnVisibility: Record<string, boolean> = {}
  config.columns.visible.forEach(col => columnVisibility[col] = true)
  config.columns.hidden.forEach(col => columnVisibility[col] = false)

  return {
    columnOrder: config.columns.visible,
    columnVisibility,
    filters: { rows: config.filters, _color: config.color },
    sorting: config.sorting.map(s => ({
      id: s.field,
      desc: s.direction === 'desc'
    })),
  }
}

type Quote = {
  id: string
  quoteNumber?: string | null
  clientName?: string | null
  containerCount?: number | null
  status: FmsQuoteStatus
  direction?: string | null
  incoterm?: string | null
  cargoType?: string | null
  originPortCode?: string | null
  destinationPortCode?: string | null
  validUntil?: string | null
  currencyCode: string
  createdAt: string
  updatedAt: string
}

type QuoteDetailsTableProps = {
  quote: Quote
  onFieldSave: (field: string, value: unknown) => Promise<void>
}

const STATUS_OPTIONS = FMS_QUOTE_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
const DIRECTION_OPTIONS = [
  { value: '', label: '-' },
  ...FMS_DIRECTIONS.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
]
const INCOTERM_OPTIONS = [
  { value: '', label: '-' },
  ...FMS_INCOTERMS.map((i) => ({ value: i, label: i.toUpperCase() })),
]
const CARGO_TYPE_OPTIONS = [
  { value: '', label: '-' },
  ...FMS_CARGO_TYPES.map((c) => ({ value: c, label: c.toUpperCase() })),
]

const COLUMNS: ColumnDef[] = [
  {
    data: 'quoteNumber',
    title: 'Quote Number',
    type: 'text',
    width: 150,
  },
  {
    data: 'clientName',
    title: 'Client',
    type: 'text',
    width: 150,
  },
  {
    data: 'status',
    title: 'Status',
    type: 'dropdown',
    source: STATUS_OPTIONS,
    width: 120,
  },
  {
    data: 'direction',
    title: 'Direction',
    type: 'dropdown',
    source: DIRECTION_OPTIONS,
    width: 120,
  },
  {
    data: 'cargoType',
    title: 'Cargo Type',
    type: 'dropdown',
    source: CARGO_TYPE_OPTIONS,
    width: 100,
  },
  {
    data: 'incoterm',
    title: 'Incoterm',
    type: 'dropdown',
    source: INCOTERM_OPTIONS,
    width: 100,
  },
  {
    data: 'originPortCode',
    title: 'Origin Port',
    type: 'text',
    width: 120,
  },
  {
    data: 'destinationPortCode',
    title: 'Dest. Port',
    type: 'text',
    width: 120,
  },
  {
    data: 'containerCount',
    title: 'Containers',
    type: 'numeric',
    width: 100,
  },
  {
    data: 'currencyCode',
    title: 'Currency',
    type: 'text',
    width: 80,
  },
  {
    data: 'validUntil',
    title: 'Valid Until',
    type: 'date',
    width: 130,
  },
  {
    data: 'createdAt',
    title: 'Created',
    type: 'text',
    readOnly: true,
    width: 160,
    renderer: (value) => {
      if (!value) return '-'
      return new Date(value).toLocaleString()
    },
  },
  {
    data: 'updatedAt',
    title: 'Updated',
    type: 'text',
    readOnly: true,
    width: 160,
    renderer: (value) => {
      if (!value) return '-'
      return new Date(value).toLocaleString()
    },
  },
]

// All column keys
const ALL_COLUMN_KEYS = COLUMNS.map(c => c.data)

export function QuoteDetailsTable({ quote, onFieldSave }: QuoteDetailsTableProps) {
  const tableRef = React.useRef<HTMLDivElement>(null)
  const columnsButtonRef = React.useRef<HTMLButtonElement>(null)
  const saveButtonRef = React.useRef<HTMLButtonElement>(null)
  const savePopoverRef = React.useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const [isColumnsOpen, setIsColumnsOpen] = React.useState(false)
  const [isSaveOpen, setIsSaveOpen] = React.useState(false)
  const [saveName, setSaveName] = React.useState('')
  const [visibleColumns, setVisibleColumns] = React.useState<string[]>(ALL_COLUMN_KEYS)
  const [hiddenColumns, setHiddenColumns] = React.useState<string[]>([])
  const [activePerspectiveId, setActivePerspectiveId] = React.useState<string | null>(null)

  // Fetch saved perspectives from API
  const { data: perspectivesData } = useQuery({
    queryKey: ['perspectives', TABLE_ID],
    queryFn: async () => {
      const response = await apiCall<PerspectivesIndexResponse>(`/api/perspectives/${TABLE_ID}`)
      if (!response.ok) return null
      return response.result ?? null
    },
  })

  // Transform API perspectives to DynamicTable format
  const savedPerspectives = React.useMemo(() => {
    if (!perspectivesData?.perspectives) return []
    const transformed = perspectivesData.perspectives.map(dto => apiToDynamicTable(dto, ALL_COLUMN_KEYS))
    console.log('[savedPerspectives] API data:', perspectivesData.perspectives)
    console.log('[savedPerspectives] transformed:', transformed)
    return transformed
  }, [perspectivesData])

  // Use ref to avoid stale closure in event handlers
  const savedPerspectivesRef = React.useRef(savedPerspectives)
  React.useEffect(() => {
    savedPerspectivesRef.current = savedPerspectives
  }, [savedPerspectives])

  // Filter and order columns based on visibility (preserving order from visibleColumns)
  const displayColumns = React.useMemo(() => {
    const cols = visibleColumns
      .map(colKey => COLUMNS.find(col => col.data === colKey))
      .filter((col): col is ColumnDef => col !== undefined)
    console.log('[displayColumns] visibleColumns:', visibleColumns)
    console.log('[displayColumns] result:', cols.map(c => c.data))
    return cols
  }, [visibleColumns])

  const handleColumnVisibilityChange = React.useCallback((visible: string[], hidden: string[]) => {
    setVisibleColumns(visible)
    setHiddenColumns(hidden)
    setActivePerspectiveId(null) // Clear active perspective when columns change
  }, [])

  const handleColumnOrderChange = React.useCallback((newOrder: string[]) => {
    setVisibleColumns(newOrder)
    setActivePerspectiveId(null)
  }, [])

  const handleSavePerspective = async () => {
    if (!saveName.trim()) return

    const newPerspective: PerspectiveConfig = {
      id: `perspective-${Date.now()}`,
      name: saveName.trim(),
      color: 'blue',
      columns: {
        visible: visibleColumns,
        hidden: hiddenColumns,
      },
      filters: [],
      sorting: [],
    }

    // Check if perspective with same name exists
    const perspectives = savedPerspectivesRef.current
    const existingPerspective = perspectives.find(p => p.name === newPerspective.name)
    const settings = dynamicTableToApi(newPerspective)

    const response = await apiCall(`/api/perspectives/${TABLE_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: existingPerspective?.id,
        name: newPerspective.name,
        settings,
      }),
    })

    if (response.ok) {
      flash('Perspective saved', 'success')
      queryClient.invalidateQueries({ queryKey: ['perspectives', TABLE_ID] })
      setActivePerspectiveId(existingPerspective?.id ?? newPerspective.id)
    } else {
      flash('Failed to save perspective', 'error')
    }

    setSaveName('')
    setIsSaveOpen(false)
  }

  const handlePerspectiveSelect = React.useCallback((payload: PerspectiveSelectEvent) => {
    const perspectiveId = payload.id
    const perspectives = savedPerspectivesRef.current
    console.log('[PerspectiveSelect] payload:', payload)
    console.log('[PerspectiveSelect] perspectiveId:', perspectiveId)
    console.log('[PerspectiveSelect] savedPerspectives (from ref):', perspectives)
    setActivePerspectiveId(perspectiveId)

    if (perspectiveId) {
      const perspective = perspectives.find(p => p.id === perspectiveId)
      console.log('[PerspectiveSelect] found perspective:', perspective)
      if (perspective) {
        console.log('[PerspectiveSelect] setting visibleColumns:', perspective.columns.visible)
        console.log('[PerspectiveSelect] setting hiddenColumns:', perspective.columns.hidden)
        setVisibleColumns(perspective.columns.visible)
        setHiddenColumns(perspective.columns.hidden)
      }
    } else {
      // Reset to all columns when "All" is selected
      console.log('[PerspectiveSelect] resetting to all columns')
      console.log('[PerspectiveSelect] ALL_COLUMN_KEYS:', ALL_COLUMN_KEYS)
      setVisibleColumns([...ALL_COLUMN_KEYS])
      setHiddenColumns([])
    }
  }, [])

  // Close save popover on outside click
  React.useEffect(() => {
    if (!isSaveOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        savePopoverRef.current &&
        !savePopoverRef.current.contains(e.target as Node) &&
        saveButtonRef.current &&
        !saveButtonRef.current.contains(e.target as Node)
      ) {
        setIsSaveOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isSaveOpen])

  // Transform quote into a single-row data array for DynamicTable
  const data = React.useMemo(() => {
    return [{
      id: quote.id,
      quoteNumber: quote.quoteNumber ?? '',
      clientName: quote.clientName ?? '',
      status: quote.status,
      direction: quote.direction ?? '',
      cargoType: quote.cargoType ?? '',
      incoterm: quote.incoterm ?? '',
      originPortCode: quote.originPortCode ?? '',
      destinationPortCode: quote.destinationPortCode ?? '',
      containerCount: quote.containerCount ?? '',
      currencyCode: quote.currencyCode,
      validUntil: quote.validUntil ? quote.validUntil.split('T')[0] : '',
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    }]
  }, [quote])

  // Handle cell edit save events using the useEventHandlers hook
  const handleCellEditSave = React.useCallback(
    async (payload: CellEditSaveEvent) => {
      const { prop, newValue, oldValue, rowIndex, colIndex } = payload

      // Skip if value hasn't changed
      if (newValue === oldValue) return

      // Dispatch save start
      if (tableRef.current) {
        dispatch(tableRef.current, TableEvents.CELL_SAVE_START, { rowIndex, colIndex })
      }

      try {
        // Convert value based on field type
        let finalValue: unknown = newValue
        if (prop === 'containerCount' && newValue !== '') {
          finalValue = parseInt(String(newValue), 10)
        } else if (newValue === '' && prop !== 'quoteNumber' && prop !== 'clientName' && prop !== 'currencyCode') {
          finalValue = null
        }

        await onFieldSave(prop, finalValue)

        // Dispatch save success
        if (tableRef.current) {
          dispatch(tableRef.current, TableEvents.CELL_SAVE_SUCCESS, { rowIndex, colIndex })
        }
      } catch (error) {
        // Dispatch save error
        if (tableRef.current) {
          dispatch(tableRef.current, TableEvents.CELL_SAVE_ERROR, {
            rowIndex,
            colIndex,
            error: error instanceof Error ? error.message : 'Save failed',
          })
        }
      }
    },
    [onFieldSave]
  )

  // Handle perspective save from DynamicTable bottom bar
  const handlePerspectiveSave = React.useCallback(
    async (payload: PerspectiveSaveEvent) => {
      const perspectives = savedPerspectivesRef.current
      const existingPerspective = perspectives.find(p => p.name === payload.perspective.name)
      const settings = dynamicTableToApi(payload.perspective)

      const response = await apiCall(`/api/perspectives/${TABLE_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: existingPerspective?.id,
          name: payload.perspective.name,
          settings,
        }),
      })

      if (response.ok) {
        flash('Perspective saved', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', TABLE_ID] })
      } else {
        flash('Failed to save perspective', 'error')
      }
    },
    [queryClient]
  )

  // Handle perspective delete
  const handlePerspectiveDelete = React.useCallback(
    async (payload: PerspectiveDeleteEvent) => {
      const response = await apiCall(`/api/perspectives/${TABLE_ID}/${payload.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        flash('Perspective deleted', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', TABLE_ID] })
        if (activePerspectiveId === payload.id) {
          setActivePerspectiveId(null)
          setVisibleColumns(ALL_COLUMN_KEYS)
          setHiddenColumns([])
        }
      } else {
        flash('Failed to delete perspective', 'error')
      }
    },
    [activePerspectiveId, queryClient]
  )

  // Handle perspective rename
  const handlePerspectiveRename = React.useCallback(
    async (payload: PerspectiveRenameEvent) => {
      const perspectives = savedPerspectivesRef.current
      const perspective = perspectives.find(p => p.id === payload.id)
      if (!perspective) return

      const settings = dynamicTableToApi(perspective)

      const response = await apiCall(`/api/perspectives/${TABLE_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: payload.id,
          name: payload.newName,
          settings,
        }),
      })

      if (response.ok) {
        flash('Perspective renamed', 'success')
        queryClient.invalidateQueries({ queryKey: ['perspectives', TABLE_ID] })
      } else {
        flash('Failed to rename perspective', 'error')
      }
    },
    [queryClient]
  )

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: handleCellEditSave,
      [TableEvents.PERSPECTIVE_SELECT]: handlePerspectiveSelect,
      [TableEvents.PERSPECTIVE_SAVE]: handlePerspectiveSave,
      [TableEvents.PERSPECTIVE_DELETE]: handlePerspectiveDelete,
      [TableEvents.PERSPECTIVE_RENAME]: handlePerspectiveRename,
    },
    tableRef,
    { stopPropagation: false }
  )

  const hiddenCount = hiddenColumns.length
  const hasChanges = hiddenCount > 0

  return (
    <div>
      {/* Custom toolbar with Columns and Save buttons */}
      <div className="flex items-center gap-2 mb-2 relative">
        <button
          ref={columnsButtonRef}
          onClick={() => setIsColumnsOpen(!isColumnsOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-md bg-white hover:bg-gray-50"
          style={{ color: hiddenCount > 0 ? '#3b82f6' : '#374151' }}
        >
          Columns
          {hiddenCount > 0 && (
            <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-[10px] font-medium">
              {hiddenCount} hidden
            </span>
          )}
        </button>

        {hasChanges && (
          <button
            ref={saveButtonRef}
            onClick={() => setIsSaveOpen(!isSaveOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-blue-500 rounded-md bg-blue-500 text-white hover:bg-blue-600"
          >
            Save View
          </button>
        )}

        <ColumnsPopover
          columns={COLUMNS}
          visibleColumns={visibleColumns}
          hiddenColumns={hiddenColumns}
          onColumnVisibilityChange={handleColumnVisibilityChange}
          onColumnOrderChange={handleColumnOrderChange}
          isOpen={isColumnsOpen}
          onClose={() => setIsColumnsOpen(false)}
          anchorRef={columnsButtonRef}
        />

        {/* Save Popover */}
        {isSaveOpen && (
          <div
            ref={savePopoverRef}
            className="absolute top-full left-20 mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-64"
          >
            <label className="block text-xs text-gray-500 mb-1">View name</label>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Enter name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSavePerspective()
                if (e.key === 'Escape') setIsSaveOpen(false)
              }}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleSavePerspective}
              disabled={!saveName.trim()}
              className="w-full px-3 py-1.5 text-xs rounded-md bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        )}
      </div>

      <DynamicTable
        key={`quote-details-${displayColumns.length}-${displayColumns.map(c => c.data).join(',')}`}
        tableRef={tableRef}
        data={data}
        columns={displayColumns}
        idColumnName="id"
        tableName="Quote Details"
        height={130}
        colHeaders={true}
        rowHeaders={false}
        savedPerspectives={savedPerspectives}
        activePerspectiveId={activePerspectiveId}
        uiConfig={{
          hideToolbar: true,
          hideSearch: true,
          hideFilterButton: true,
          hideAddRowButton: true,
          hideBottomBar: false,
        }}
      />
    </div>
  )
}
