'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  DynamicTable,
  TableSkeleton,
  TableEvents,
  dispatch,
  useEventHandlers,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  CellEditSaveEvent,
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
  NewRowSaveEvent,
  NewRowSaveSuccessEvent,
  NewRowSaveErrorEvent,
  FilterRow,
  ColumnDef,
  PerspectiveConfig,
  PerspectiveSaveEvent,
  PerspectiveSelectEvent,
  PerspectiveRenameEvent,
  PerspectiveDeleteEvent,
  SortRule,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  PerspectivesIndexResponse,
  PerspectiveDto,
  PerspectiveSettings,
} from '@open-mercato/shared/modules/perspectives/types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useTableConfig } from '../../components/useTableConfig'
import { QuoteDrawer } from '../../components/QuoteDrawer'
import { QuotePreviewDrawer } from '../../components/QuotePreviewDrawer'

interface FmsQuoteRow {
  id: string
  quoteNumber: string
  status: string
  direction: string
  incoterm?: string | null
  cargoType: string
  originPortCode?: string | null
  destinationPortCode?: string | null
  validUntil?: string | null
  currencyCode: string
  notes?: string | null
  createdAt: string
  updatedAt: string
}

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    ready: 'bg-blue-100 text-blue-800',
    offered: 'bg-indigo-100 text-indigo-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
    expired: 'bg-yellow-100 text-yellow-800',
    archived: 'bg-gray-200 text-gray-600',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

const StatusRenderer = ({ value }: { value: string }) => {
  if (!value) return <span>-</span>
  return (
    <span
      className={`px-2 py-0.5 inline-flex text-xs leading-4 font-semibold rounded-full ${getStatusColor(value)}`}
    >
      {value.toUpperCase()}
    </span>
  )
}

// Global ref to store the quote click handler (set by the page component)
let onQuoteClickHandler: ((quoteId: string) => void) | null = null

export function setQuoteClickHandler(handler: ((quoteId: string) => void) | null) {
  onQuoteClickHandler = handler
}

const QuoteNumberRenderer = ({ value, rowData }: { value: string; rowData: { id: string } }) => {
  const displayValue = value || `#${rowData.id?.slice(0, 8) || '...'}`
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (onQuoteClickHandler && rowData.id) {
          onQuoteClickHandler(rowData.id)
        }
      }}
      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left"
    >
      {displayValue}
    </button>
  )
}

const RENDERERS: Record<string, (value: any, rowData: any) => React.ReactNode> = {
  StatusRenderer: (value) => <StatusRenderer value={value} />,
  QuoteNumberRenderer: (value, rowData) => <QuoteNumberRenderer value={value} rowData={rowData} />,
}

function apiToDynamicTable(dto: PerspectiveDto, allColumns: string[]): PerspectiveConfig {
  const { columnOrder = [], columnVisibility = {} } = dto.settings

  const visible =
    columnOrder.length > 0
      ? columnOrder.filter((col) => columnVisibility[col] !== false)
      : allColumns
  const hidden = allColumns.filter((col) => !visible.includes(col))

  const apiFilters = dto.settings.filters as Record<string, unknown> | undefined
  const filters: FilterRow[] = Array.isArray(apiFilters)
    ? (apiFilters as FilterRow[])
    : ((apiFilters?.rows as FilterRow[]) ?? [])
  const color = apiFilters?._color as PerspectiveConfig['color']

  const sorting: SortRule[] = (dto.settings.sorting ?? []).map((s) => ({
    id: s.id,
    field: s.id,
    direction: (s.desc ? 'desc' : 'asc') as 'asc' | 'desc',
  }))

  return { id: dto.id, name: dto.name, color, columns: { visible, hidden }, filters, sorting }
}

function dynamicTableToApi(config: PerspectiveConfig): PerspectiveSettings {
  const columnVisibility: Record<string, boolean> = {}
  config.columns.visible.forEach((col) => (columnVisibility[col] = true))
  config.columns.hidden.forEach((col) => (columnVisibility[col] = false))

  return {
    columnOrder: config.columns.visible,
    columnVisibility,
    filters: { rows: config.filters, _color: config.color },
    sorting: config.sorting.map((s) => ({
      id: s.field,
      desc: s.direction === 'desc',
    })),
  }
}

export default function FmsQuotesPage() {
  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const router = useRouter()

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewQuoteId, setPreviewQuoteId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortField, setSortField] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<FilterRow[]>([])

  const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([])
  const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null)

  const { data: tableConfig, isLoading: configLoading } = useTableConfig('fms_quotes')

  // Register the quote click handler for the renderer
  useEffect(() => {
    setQuoteClickHandler((quoteId: string) => {
      setPreviewQuoteId(quoteId)
      setIsPreviewOpen(true)
    })
    return () => setQuoteClickHandler(null)
  }, [])

  const { data: perspectivesData } = useQuery({
    queryKey: ['perspectives', 'fms_quotes'],
    queryFn: async () => {
      const response = await apiCall<PerspectivesIndexResponse>('/api/perspectives/fms_quotes')
      return response.ok ? response.result : null
    },
  })

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)
    if (search) params.set('q', search)
    if (filters.length) params.set('filters', JSON.stringify(filters))
    return params.toString()
  }, [page, limit, sortField, sortDir, search, filters])

  const { data, isLoading: dataLoading } = useQuery({
    queryKey: ['fms_quotes', queryParams],
    queryFn: async () => {
      const call = await apiCall<{ items: FmsQuoteRow[]; total: number; totalPages?: number }>(
        `/api/fms_quotes?${queryParams}`
      )
      if (!call.ok) throw new Error('Failed to load quotes')
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const tableData = useMemo(() => {
    return (data?.items ?? []).map((quote) => {
      const camelCaseObject: Record<string, any> = { id: quote.id }

      Object.keys(quote).forEach((key) => {
        if (key === 'id') return

        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        const value = quote[key as keyof FmsQuoteRow]
        camelCaseObject[camelKey] = value
      })

      return camelCaseObject
    })
  }, [data?.items])

  const columns = useMemo((): ColumnDef[] => {
    if (!tableConfig?.columns) return []
    return tableConfig.columns.map((col) => ({
      ...col,
      type: col.type === 'checkbox' ? 'boolean' : col.type,
      renderer: col.renderer ? RENDERERS[col.renderer] : undefined,
    })) as ColumnDef[]
  }, [tableConfig])

  useEffect(() => {
    if (perspectivesData?.perspectives && columns.length > 0) {
      const allCols = columns.map((c) => c.data)
      const transformed = perspectivesData.perspectives.map((p) => apiToDynamicTable(p, allCols))
      setSavedPerspectives(transformed)
      if (perspectivesData.defaultPerspectiveId && !activePerspectiveId) {
        setActivePerspectiveId(perspectivesData.defaultPerspectiveId)
      }
    }
  }, [perspectivesData, columns])

  const handleQuoteCreated = useCallback(
    (quoteId: string, navigateToDetail: boolean) => {
      queryClient.invalidateQueries({ queryKey: ['fms_quotes'] })
      if (navigateToDetail) {
        router.push(`/backend/fms-quotes/${quoteId}`)
      }
    },
    [queryClient, router]
  )

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent)

        try {
          const response = await apiCall<{ error?: string }>(`/api/fms_quotes/${payload.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [payload.prop]: payload.newValue }),
          })

          if (response.ok) {
            flash('Quote updated', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
            } as CellSaveSuccessEvent)
          } else {
            const error = response.result?.error || 'Update failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
              error,
            } as CellSaveErrorEvent)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: errorMessage,
          } as CellSaveErrorEvent)
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        const filteredRowData = Object.fromEntries(
          Object.entries(payload.rowData).filter(([_, value]) => value !== '')
        )

        try {
          const response = await apiCall<{ id: string; error?: string }>(`/api/fms_quotes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filteredRowData),
          })

          if (response.ok && response.result) {
            flash('Quote created', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              savedRowData: {
                ...payload.rowData,
                id: response.result.id,
              },
            } as NewRowSaveSuccessEvent)
            queryClient.invalidateQueries({ queryKey: ['fms_quotes'] })
          } else {
            const error = response.result?.error || 'Creation failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              error,
            } as NewRowSaveErrorEvent)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error: errorMessage,
          } as NewRowSaveErrorEvent)
        }
      },

      [TableEvents.COLUMN_SORT]: (payload: {
        columnName: string
        direction: 'asc' | 'desc' | null
      }) => {
        setSortField(payload.columnName)
        setSortDir(payload.direction || 'asc')
        setPage(1)
      },

      [TableEvents.SEARCH]: (payload: { query: string }) => {
        setSearch(payload.query)
        setPage(1)
      },

      [TableEvents.FILTER_CHANGE]: (payload: { filters: FilterRow[] }) => {
        setFilters(payload.filters)
        setPage(1)
      },

      [TableEvents.PERSPECTIVE_SAVE]: async (payload: PerspectiveSaveEvent) => {
        const settings = dynamicTableToApi(payload.perspective)
        const existingPerspective = savedPerspectives.find(
          (p) => p.name === payload.perspective.name
        )
        const response = await apiCall('/api/perspectives/fms_quotes', {
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
          queryClient.invalidateQueries({ queryKey: ['perspectives', 'fms_quotes'] })
        } else {
          flash('Failed to save perspective', 'error')
        }
      },

      [TableEvents.PERSPECTIVE_SELECT]: (payload: PerspectiveSelectEvent) => {
        setActivePerspectiveId(payload.id)
        if (payload.config) {
          setFilters(payload.config.filters)
          if (payload.config.sorting.length > 0) {
            setSortField(payload.config.sorting[0].field)
            setSortDir(payload.config.sorting[0].direction)
          }
          setPage(1)
        } else {
          setFilters([])
          setSortField('createdAt')
          setSortDir('desc')
          setPage(1)
        }
      },

      [TableEvents.PERSPECTIVE_RENAME]: async (payload: PerspectiveRenameEvent) => {
        const perspective = savedPerspectives.find((p) => p.id === payload.id)
        if (perspective) {
          const settings = dynamicTableToApi(perspective)
          const response = await apiCall('/api/perspectives/fms_quotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: payload.id, name: payload.newName, settings }),
          })
          if (response.ok) {
            flash('Perspective renamed', 'success')
            queryClient.invalidateQueries({ queryKey: ['perspectives', 'fms_quotes'] })
          } else {
            flash('Failed to rename perspective', 'error')
          }
        }
      },

      [TableEvents.PERSPECTIVE_DELETE]: async (payload: PerspectiveDeleteEvent) => {
        const response = await apiCall(`/api/perspectives/fms_quotes/${payload.id}`, {
          method: 'DELETE',
        })
        if (response.ok) {
          flash('Perspective deleted', 'success')
          queryClient.invalidateQueries({ queryKey: ['perspectives', 'fms_quotes'] })
          if (activePerspectiveId === payload.id) {
            setActivePerspectiveId(null)
            setFilters([])
            setSortField('createdAt')
            setSortDir('desc')
          }
        } else {
          flash('Failed to delete perspective', 'error')
        }
      },
    },
    tableRef as React.RefObject<HTMLElement>
  )

  if (configLoading) {
    return (
      <Page>
        <PageBody>
          <TableSkeleton rows={10} columns={8} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DynamicTable
          tableRef={tableRef}
          data={tableData}
          columns={columns}
          tableName="Freight Quotes"
          idColumnName="id"
          height={600}
          colHeaders={true}
          rowHeaders={true}
          savedPerspectives={savedPerspectives}
          activePerspectiveId={activePerspectiveId}
          uiConfig={{
            hideAddRowButton: true,
            enableFullscreen: true,
            topBarEnd: (
              <Button onClick={() => setIsDrawerOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New Quote
              </Button>
            ),
          }}
          pagination={{
            currentPage: page,
            totalPages: Math.ceil((data?.total || 0) / limit),
            limit,
            limitOptions: [25, 50, 100],
            onPageChange: setPage,
            onLimitChange: (l) => {
              setLimit(l)
              setPage(1)
            },
          }}
          debug={process.env.NODE_ENV === 'development'}
        />
        <QuoteDrawer
          open={isDrawerOpen}
          onOpenChange={setIsDrawerOpen}
          onCreated={handleQuoteCreated}
        />
        <QuotePreviewDrawer
          quoteId={previewQuoteId}
          open={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
        />
      </PageBody>
    </Page>
  )
}
