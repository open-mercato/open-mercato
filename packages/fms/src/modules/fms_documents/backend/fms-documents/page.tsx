'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Trash2, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
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
import { DocumentUploadDialog } from '../../components/DocumentUploadDialog'

interface FmsDocumentRow {
  id: string
  name: string
  category?: string | null
  description?: string | null
  attachmentId: string
  createdAt: string
  updatedAt: string
}

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    offer: 'bg-blue-100 text-blue-800',
    invoice: 'bg-green-100 text-green-800',
    customs: 'bg-purple-100 text-purple-800',
    bill_of_lading: 'bg-orange-100 text-orange-800',
    other: 'bg-gray-100 text-gray-800',
  }
  return colors[category] || 'bg-gray-100 text-gray-800'
}

const CategoryBadgeRenderer = ({ value }: { value: string }) => {
  if (!value) return <span>-</span>
  const displayValue = value.replace(/_/g, ' ')
  return (
    <span
      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${getCategoryColor(value)}`}
    >
      {displayValue}
    </span>
  )
}

const RENDERERS: Record<string, (value: any, rowData: any) => React.ReactNode> = {
  CategoryBadgeRenderer: (value) => <CategoryBadgeRenderer value={value} />,
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

export default function FmsDocumentsPage() {
  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState<FmsDocumentRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortField, setSortField] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<FilterRow[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([])
  const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null)

  const { data: tableConfig, isLoading: configLoading } = useTableConfig('fms_documents')

  const { data: perspectivesData } = useQuery({
    queryKey: ['perspectives', 'fms_documents'],
    queryFn: async () => {
      const response = await apiCall<PerspectivesIndexResponse>('/api/perspectives/fms_documents')
      return response.ok ? response.result : null
    },
  })

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)
    if (search) params.set('search', search)
    if (filters.length) params.set('filters', JSON.stringify(filters))
    return params.toString()
  }, [page, limit, sortField, sortDir, search, filters])

  const { data } = useQuery({
    queryKey: ['fms_documents', queryParams],
    queryFn: async () => {
      const call = await apiCall<{ items: FmsDocumentRow[]; total: number; totalPages?: number }>(
        `/api/fms_documents/documents?${queryParams}`
      )
      if (!call.ok) throw new Error('Failed to load documents')
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const tableData = useMemo(() => {
    return data?.items ?? []
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

  const handleDocumentUploaded = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['fms_documents'] })
    setIsUploadDialogOpen(false)
  }, [queryClient])

  const handleConfirmDelete = useCallback(async () => {
    if (!documentToDelete) return

    setIsDeleting(true)
    const endpoint = `/api/fms_documents/documents/${documentToDelete.id}`

    try {
      const response = await apiCall<{ error?: string }>(endpoint, {
        method: 'DELETE',
      })

      if (response.ok) {
        flash('Document deleted', 'success')
        queryClient.invalidateQueries({ queryKey: ['fms_documents'] })
        setDocumentToDelete(null)
      } else {
        flash(response.result?.error || 'Failed to delete document', 'error')
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Failed to delete document', 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [documentToDelete, queryClient])

  const handleDownload = useCallback((row: FmsDocumentRow) => {
    window.open(`/api/fms_documents/documents/${row.id}/download`, '_blank')
  }, [])

  const handleFileUpload = useCallback(
    async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      // Use filename without extension as the document name
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '')
      formData.append('name', nameWithoutExt)
      formData.append('category', '')
      formData.append('description', '')

      try {
        const response = await fetch('/api/fms_documents/upload', {
          method: 'POST',
          body: formData,
        })

        const result = await response.json()

        if (response.ok && result.ok) {
          return { success: true }
        } else {
          return { success: false, error: result.error || 'Upload failed' }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Upload failed',
        }
      }
    },
    []
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return

      setIsUploading(true)

      let successCount = 0
      let failCount = 0

      for (const file of files) {
        const result = await handleFileUpload(file)
        if (result.success) {
          successCount++
        } else {
          failCount++
          console.error(`Failed to upload ${file.name}:`, result.error)
        }
      }

      setIsUploading(false)

      if (successCount > 0) {
        flash(
          successCount === 1
            ? 'Document uploaded successfully'
            : `${successCount} documents uploaded successfully`,
          'success'
        )
        queryClient.invalidateQueries({ queryKey: ['fms_documents'] })
      }

      if (failCount > 0) {
        flash(
          failCount === 1
            ? 'Failed to upload 1 document'
            : `Failed to upload ${failCount} documents`,
          'error'
        )
      }
    },
    [handleFileUpload, queryClient]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set to false if we're leaving the container itself, not a child element
    if (e.currentTarget === e.target) {
      setIsDragOver(false)
    }
  }, [])

  const actionsRenderer = useCallback((rowData: any, _rowIndex: number) => {
    const row = rowData as FmsDocumentRow
    if (!row.id) return null
    return (
      <div className="flex gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload(row)
          }}
          className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setDocumentToDelete(row)
          }}
          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    )
  }, [handleDownload])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        const rowData = tableData[payload.rowIndex] as FmsDocumentRow | undefined
        if (!rowData) return

        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        } as CellSaveStartEvent)

        const endpoint = `/api/fms_documents/documents/${payload.id}`

        try {
          const response = await apiCall<{ error?: string }>(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [payload.prop]: payload.newValue }),
          })

          if (response.ok) {
            flash('Document updated', 'success')
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

      [TableEvents.COLUMN_SORT]: (payload: {
        columnName: string
        direction: 'asc' | 'desc' | null
      }) => {
        setSortField(payload.columnName)
        setSortDir(payload.direction || 'asc')
      },

      [TableEvents.SEARCH]: (payload) => {
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

        try {
          const response = await apiCall<{ id: string }>('/api/perspectives/fms_documents', {
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
            queryClient.invalidateQueries({ queryKey: ['perspectives', 'fms_documents'] })
          } else {
            flash('Failed to save perspective', 'error')
          }
        } catch (error) {
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
        }
      },

      [TableEvents.PERSPECTIVE_RENAME]: async (payload: PerspectiveRenameEvent) => {
        try {
          const response = await apiCall(`/api/perspectives/fms_documents/${payload.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: payload.newName }),
          })

          if (response.ok) {
            flash('Perspective renamed', 'success')
            queryClient.invalidateQueries({ queryKey: ['perspectives', 'fms_documents'] })
          } else {
            flash('Failed to rename perspective', 'error')
          }
        } catch (error) {
          flash('Failed to rename perspective', 'error')
        }
      },

      [TableEvents.PERSPECTIVE_DELETE]: async (payload: PerspectiveDeleteEvent) => {
        try {
          const response = await apiCall(`/api/perspectives/fms_documents/${payload.id}`, {
            method: 'DELETE',
          })

          if (response.ok) {
            flash('Perspective deleted', 'success')
            queryClient.invalidateQueries({ queryKey: ['perspectives', 'fms_documents'] })
            if (activePerspectiveId === payload.id) {
              setActivePerspectiveId(null)
            }
          } else {
            flash('Failed to delete perspective', 'error')
          }
        } catch (error) {
          flash('Failed to delete perspective', 'error')
        }
      },
    },
    tableRef
  )

  if (configLoading) {
    return <TableSkeleton />
  }

  return (
    <div
      className="flex flex-col h-full relative"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-blue-500/10 border-4 border-dashed border-blue-500 rounded-lg flex items-center justify-center pointer-events-none">
          <div className="bg-white dark:bg-gray-800 px-8 py-4 rounded-lg shadow-lg">
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
              Drop files here to upload
            </p>
          </div>
        </div>
      )}
      {isUploading && (
        <div className="absolute inset-0 z-50 bg-black/20 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 px-8 py-4 rounded-lg shadow-lg">
            <p className="text-lg font-semibold">Uploading documents...</p>
          </div>
        </div>
      )}
      <div className="flex-1">
        <DynamicTable
          tableRef={tableRef}
          data={tableData}
          columns={columns}
          tableName="Documents"
          idColumnName="id"
          height="calc(100vh - 110px)"
          colHeaders={true}
          rowHeaders={true}
          savedPerspectives={savedPerspectives}
          activePerspectiveId={activePerspectiveId}
          actionsRenderer={actionsRenderer}
          uiConfig={{
            hideAddRowButton: true,
            enableFullscreen: true,
            topBarEnd: (
              <Button onClick={() => setIsUploadDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Upload Document
              </Button>
            ),
          }}
          pagination={{
            currentPage: page,
            totalPages: Math.ceil((data?.total || 0) / limit),
            limit,
            limitOptions: [25, 50, 100],
            onPageChange: setPage,
            onLimitChange: (l: number) => {
              setLimit(l)
              setPage(1)
            },
          }}
          debug={process.env.NODE_ENV === 'development'}
        />
      </div>

      <DocumentUploadDialog
        open={isUploadDialogOpen}
        onOpenChange={setIsUploadDialogOpen}
        onSuccess={handleDocumentUploaded}
      />

      <Dialog open={!!documentToDelete} onOpenChange={() => setDocumentToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{documentToDelete?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentToDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
