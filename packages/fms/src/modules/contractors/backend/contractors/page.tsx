'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Trash2, Check } from 'lucide-react'
import {
  DynamicTable,
  TableSkeleton,
  TableEvents,
  dispatch,
  useEventHandlers,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  CellEditSaveEvent,
  NewRowSaveEvent,
  FilterRow,
  ColumnDef,
  PerspectiveConfig,
  PerspectiveSaveEvent,
  PerspectiveSelectEvent,
  PerspectiveRenameEvent,
  PerspectiveDeleteEvent,
  PerspectiveChangeEvent,
  SortRule,
} from '@open-mercato/ui/backend/dynamic-table'
import type {
  PerspectivesIndexResponse,
  PerspectiveDto,
  PerspectiveSettings,
} from '@open-mercato/shared/modules/perspectives/types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { ContractorDrawer } from '../../components/ContractorDrawer'
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog'

type PrimaryAddress = {
  addressLine: string
  city: string
  countryCode: string
}

type RoleType = {
  id: string
  name: string
  code: string
  color?: string | null
  category: string
}

type ContractorRow = {
  id: string
  name: string
  shortName?: string | null
  taxId?: string | null
  isActive: boolean
  createdAt?: string
  roleTypeIds?: string[]
  primaryContactEmail?: string | null
  primaryAddress?: PrimaryAddress | null
}

type ContractorsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

type RoleOption = {
  value: string
  label: string
  color?: string | null
}

// Multi-select dropdown editor for roles
const MultiSelectEditor = ({
  value,
  options,
  onChange,
  onSave,
  onCancel,
}: {
  value: string[]
  options: RoleOption[]
  onChange: (val: string[]) => void
  onSave: (val: string[]) => void
  onCancel: () => void
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    Array.isArray(value) ? value : []
  )
  const [showDropdown, setShowDropdown] = useState(true)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  const cellRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect()
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft
      setPosition({
        top: rect.bottom + scrollTop + 2,
        left: rect.left + scrollLeft,
        width: Math.max(rect.width, 200),
      })
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const isOutsideCell = cellRef.current && !cellRef.current.contains(e.target as Node)
      const isOutsideDropdown = !dropdownRef.current || !dropdownRef.current.contains(e.target as Node)

      if (isOutsideCell && isOutsideDropdown) {
        setShowDropdown(false)
        onSave(selectedIds)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onSave, selectedIds])

  const handleToggle = (optionValue: string) => {
    const newIds = selectedIds.includes(optionValue)
      ? selectedIds.filter((id) => id !== optionValue)
      : [...selectedIds, optionValue]
    setSelectedIds(newIds)
    onChange(newIds)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      setShowDropdown(false)
      onSave(selectedIds)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setShowDropdown(false)
      onCancel()
    }
  }

  const selectedLabels = options
    .filter((opt) => selectedIds.includes(opt.value))
    .map((opt) => opt.label)
    .join(', ')

  return (
    <>
      <div
        ref={cellRef}
        className="hot-cell-editor flex items-center min-h-[28px] px-1 cursor-pointer"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <span className="truncate text-sm">
          {selectedLabels || 'Select roles...'}
        </span>
      </div>

      {showDropdown && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="bg-white border border-gray-200 rounded-md shadow-lg"
          style={{
            position: 'absolute',
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: '250px',
            overflowY: 'auto',
            zIndex: 10000,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((option) => {
            const isSelected = selectedIds.includes(option.value)
            return (
              <div
                key={option.value}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                  isSelected ? 'bg-blue-50' : ''
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleToggle(option.value)
                }}
              >
                <div
                  className={`w-4 h-4 border rounded flex items-center justify-center ${
                    isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                <span className="text-sm">{option.label}</span>
              </div>
            )
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No roles available</div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

function mapApiItem(item: Record<string, unknown>): ContractorRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    shortName: typeof item.shortName === 'string' ? item.shortName : null,
    taxId: typeof item.taxId === 'string' ? item.taxId : null,
    isActive: item.isActive === true,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    roleTypeIds: Array.isArray(item.roleTypeIds) ? item.roleTypeIds as string[] : [],
    primaryContactEmail: typeof item.primaryContactEmail === 'string' ? item.primaryContactEmail : null,
    primaryAddress: item.primaryAddress as PrimaryAddress | null ?? null,
  }
}

// Transform API perspective format to DynamicTable format
function apiToDynamicTable(dto: PerspectiveDto, allColumns: string[]): PerspectiveConfig {
  const { columnOrder = [], columnVisibility = {} } = dto.settings

  const visible = columnOrder.length > 0
    ? columnOrder.filter(col => columnVisibility[col] !== false)
    : allColumns
  const hidden = allColumns.filter(col => !visible.includes(col))

  const apiFilters = dto.settings.filters as Record<string, unknown> | undefined
  const filters: FilterRow[] = Array.isArray(apiFilters)
    ? apiFilters as FilterRow[]
    : (apiFilters?.rows as FilterRow[]) ?? []
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

// Global ref to store the contractor click handler
let onContractorClickHandler: ((contractorId: string) => void) | null = null

export function setContractorClickHandler(handler: ((contractorId: string) => void) | null) {
  onContractorClickHandler = handler
}

// Global ref to store the contractor delete handler
let onContractorDeleteHandler: ((contractorId: string) => void) | null = null

export function setContractorDeleteHandler(handler: ((contractorId: string) => void) | null) {
  onContractorDeleteHandler = handler
}

const DeleteButton = ({ id }: { id: string }) => {
  if (!id) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (onContractorDeleteHandler && id) {
          onContractorDeleteHandler(id)
        }
      }}
      className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
      title="Delete contractor"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

const ContractorNameRenderer = ({ value, rowData }: { value: string; rowData: { id: string } }) => {
  const isUnsavedRow = !rowData.id || rowData.id === ''
  const displayValue = value || '-'

  if (isUnsavedRow) {
    return <span className="font-medium">{displayValue}</span>
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (onContractorClickHandler && rowData.id) {
          onContractorClickHandler(rowData.id)
        }
      }}
      className="text-blue-600 hover:text-blue-800 hover:underline font-medium text-left"
    >
      {displayValue}
    </button>
  )
}

const StatusBadgeRenderer = ({ value }: { value: boolean }) => {
  return (
    <Badge variant={value ? 'default' : 'secondary'}>
      {value ? 'Active' : 'Inactive'}
    </Badge>
  )
}

// Static columns definition
const COLUMNS: ColumnDef[] = [
  {
    data: 'name',
    title: 'Name',
    type: 'text',
    width: 220,
    renderer: (value: string, rowData: { id: string }) => <ContractorNameRenderer value={value} rowData={rowData} />,
  },
  { data: 'shortName', title: 'Short Name', type: 'text', width: 120 },
  { data: 'taxId', title: 'Tax ID', type: 'text', width: 120 },
  {
    data: 'roleTypeIds',
    title: 'Roles',
    type: 'text',
    width: 200,
    // editor and renderer are added dynamically in the component to access roleTypesMap
  },
  {
    data: 'isActive',
    title: 'Status',
    type: 'boolean',
    width: 100,
    renderer: (value: boolean) => <StatusBadgeRenderer value={value} />,
  },
]

export default function ContractorsPage() {
  const tableRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedContractorId, setSelectedContractorId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [sortField, setSortField] = useState('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [contractorToDelete, setContractorToDelete] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [filters, setFilters] = useState<FilterRow[]>([])

  // Perspective state
  const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([])
  const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null)

  // Register the contractor click handler for the renderer
  useEffect(() => {
    setContractorClickHandler((contractorId: string) => {
      setSelectedContractorId(contractorId)
      setIsDrawerOpen(true)
    })
    return () => setContractorClickHandler(null)
  }, [])

  // Register the contractor delete handler for the renderer
  const openDeleteDialog = useCallback((contractorId: string) => {
    setContractorToDelete(contractorId)
    setDeleteDialogOpen(true)
  }, [])

  useEffect(() => {
    setContractorDeleteHandler(openDeleteDialog)
    return () => setContractorDeleteHandler(null)
  }, [openDeleteDialog])

  const handleDeleteConfirm = useCallback(async () => {
    if (!contractorToDelete) return
    setIsDeleting(true)
    try {
      const response = await apiCall(`/api/contractors/contractors/${contractorToDelete}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        flash('Contractor deleted', 'success')
        setDeleteDialogOpen(false)
        setContractorToDelete(null)
        queryClient.invalidateQueries({ queryKey: ['contractors'] })
      } else {
        const error = (response.result as { error?: string })?.error ?? 'Delete failed'
        flash(error, 'error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      flash(errorMessage, 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [contractorToDelete, queryClient])

  const actionsRenderer = useCallback((rowData: { id: string }) => {
    if (!rowData?.id) return null
    return <DeleteButton id={rowData.id} />
  }, [])

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(limit))
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)
    if (search) params.set('search', search)
    if (filters.length) params.set('filters', JSON.stringify(filters))
    return params.toString()
  }, [page, limit, sortField, sortDir, search, filters])

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['contractors', queryParams, scopeVersion],
    queryFn: async () => {
      const call = await apiCall<ContractorsResponse>(`/api/contractors/contractors?${queryParams}`)
      if (!call.ok) throw new Error('Failed to load contractors')
      const payload = call.result ?? {}
      const items = Array.isArray(payload.items) ? payload.items : []
      return {
        items: items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is ContractorRow => !!row),
        total: typeof payload.total === 'number' ? payload.total : items.length,
        totalPages: typeof payload.totalPages === 'number' ? payload.totalPages : 1,
      }
    },
    placeholderData: (previousData) => previousData, // Keep previous data while loading new data
  })

  // Fetch role types for dropdown
  const { data: roleTypesData } = useQuery({
    queryKey: ['contractor-role-types'],
    queryFn: async () => {
      const response = await apiCall<{ items: RoleType[] }>('/api/contractors/role-types')
      if (!response.ok) throw new Error('Failed to load role types')
      return response.result?.items ?? []
    },
  })

  // Fetch perspectives
  const { data: perspectivesData } = useQuery({
    queryKey: ['perspectives', 'contractors'],
    queryFn: async () => {
      const response = await apiCall<PerspectivesIndexResponse>('/api/perspectives/contractors')
      return response.ok ? response.result : null
    }
  })

  const roleTypesMap = useMemo(() => {
    const map = new Map<string, RoleType>()
    ;(roleTypesData ?? []).forEach((rt) => map.set(rt.id, rt))
    return map
  }, [roleTypesData])

  // Role type options with colors for the editor
  const roleOptionsWithColor = useMemo(() =>
    (roleTypesData ?? []).map((rt) => ({
      value: rt.id,
      label: rt.name,
      color: rt.color,
    })),
    [roleTypesData]
  )

  // Create dynamic columns with role type options, custom editor and renderer
  const columns = useMemo(() => {
    return COLUMNS.map((col) => {
      if (col.data === 'roleTypeIds') {
        return {
          ...col,
          editor: (
            value: unknown,
            onChange: (val: unknown) => void,
            onSave: (val?: unknown) => void,
            onCancel: () => void,
          ) => {
            const currentValue = Array.isArray(value) ? value : []
            return (
              <MultiSelectEditor
                value={currentValue}
                options={roleOptionsWithColor}
                onChange={(val) => onChange(val)}
                onSave={(val) => onSave(val)}
                onCancel={onCancel}
              />
            )
          },
          renderer: (value: unknown, rowData: Record<string, unknown>) => {
            // Get roleTypeIds from rowData since value might be transformed
            const ids = rowData?.roleTypeIds
            const roleTypeIds = Array.isArray(ids) ? ids : (Array.isArray(value) ? value : [])

            if (roleTypeIds.length === 0) {
              return <span className="text-gray-400">-</span>
            }
            return (
              <span className="flex flex-wrap gap-1">
                {roleTypeIds.map((roleTypeId: string) => {
                  const roleType = roleTypesMap.get(roleTypeId)
                  if (!roleType) return null
                  return (
                    <Badge
                      key={roleTypeId}
                      variant="outline"
                      style={roleType.color ? { borderColor: roleType.color, color: roleType.color } : undefined}
                    >
                      {roleType.name}
                    </Badge>
                  )
                })}
              </span>
            )
          },
        }
      }
      return col
    })
  }, [roleOptionsWithColor, roleTypesMap])

  // Transform API perspectives to DynamicTable format
  useEffect(() => {
    if (perspectivesData?.perspectives && columns.length > 0) {
      const allCols = columns.map(c => c.data)
      const transformed = perspectivesData.perspectives.map(p => apiToDynamicTable(p, allCols))
      setSavedPerspectives(transformed)
      if (perspectivesData.defaultPerspectiveId && !activePerspectiveId) {
        setActivePerspectiveId(perspectivesData.defaultPerspectiveId)
      }
    }
  }, [perspectivesData, columns])

  const tableData = useMemo(() => {
    return (data?.items ?? []).map((contractor) => ({
      id: contractor.id,
      name: contractor.name,
      shortName: contractor.shortName ?? '',
      taxId: contractor.taxId ?? '',
      roleTypeIds: contractor.roleTypeIds ?? [],
      isActive: contractor.isActive,
    }))
  }, [data?.items])

  const handleContractorUpdated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['contractors'] })
  }, [queryClient])

  useEventHandlers(
    {
      [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
        dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_START, {
          rowIndex: payload.rowIndex,
          colIndex: payload.colIndex,
        })

        try {
          let response: { ok: boolean; result?: { error?: string } | null }

          if (payload.prop === 'roleTypeIds') {
            // Update role type IDs
            const roleTypeIds = Array.isArray(payload.newValue) ? payload.newValue : []
            response = await apiCall<{ error?: string }>(`/api/contractors/contractors/${payload.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roleTypeIds }),
            })
          } else {
            // Regular contractor field update
            response = await apiCall<{ error?: string }>(`/api/contractors/contractors/${payload.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [payload.prop]: payload.newValue === '' ? null : payload.newValue }),
            })
          }

          if (response.ok) {
            flash('Contractor updated', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
            })
            queryClient.invalidateQueries({ queryKey: ['contractors'] })
          } else {
            const error = response.result?.error || 'Update failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              colIndex: payload.colIndex,
              error,
            })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.CELL_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            colIndex: payload.colIndex,
            error: errorMessage,
          })
        }
      },

      [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
        const rowData = payload.rowData as Record<string, unknown>

        const filteredRowData = Object.fromEntries(
          Object.entries(rowData).filter(([_, value]) => value !== '')
        )

        if (!filteredRowData.name) {
          flash('Name is required', 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error: 'Name is required',
          })
          return
        }

        try {
          const response = await apiCall<{ id: string; error?: string }>('/api/contractors/contractors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filteredRowData),
          })

          if (response.ok && response.result) {
            flash('Contractor created', 'success')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_SUCCESS, {
              rowIndex: payload.rowIndex,
              savedRowData: {
                ...payload.rowData,
                id: response.result.id,
              },
            })
            queryClient.invalidateQueries({ queryKey: ['contractors'] })
          } else {
            const error = response.result?.error || 'Creation failed'
            flash(error, 'error')
            dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
              rowIndex: payload.rowIndex,
              error,
            })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          flash(errorMessage, 'error')
          dispatch(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE_ERROR, {
            rowIndex: payload.rowIndex,
            error: errorMessage,
          })
        }
      },

      [TableEvents.COLUMN_SORT]: (payload: { columnName: string; direction: 'asc' | 'desc' | null }) => {
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

      [TableEvents.PERSPECTIVE_CHANGE]: (payload: PerspectiveChangeEvent) => {
        // Handle sort rules change from Sort popover
        if (payload.config.sorting) {
          if (payload.config.sorting.length > 0) {
            const firstSort = payload.config.sorting[0]
            setSortField(firstSort.field)
            setSortDir(firstSort.direction)
          } else {
            // Reset to default when all sorts removed
            setSortField('createdAt')
            setSortDir('desc')
          }
          setPage(1)
        }
      },

      // Perspective event handlers
      [TableEvents.PERSPECTIVE_SAVE]: async (payload: PerspectiveSaveEvent) => {
        const settings = dynamicTableToApi(payload.perspective)
        const existingPerspective = savedPerspectives.find(p => p.name === payload.perspective.name)
        const response = await apiCall('/api/perspectives/contractors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: existingPerspective?.id,
            name: payload.perspective.name,
            settings
          })
        })
        if (response.ok) {
          flash('Perspective saved', 'success')
          queryClient.invalidateQueries({ queryKey: ['perspectives', 'contractors'] })
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
          // Reset to default when "All" is selected
          setFilters([])
          setSortField('createdAt')
          setSortDir('desc')
          setPage(1)
        }
      },

      [TableEvents.PERSPECTIVE_RENAME]: async (payload: PerspectiveRenameEvent) => {
        const perspective = savedPerspectives.find(p => p.id === payload.id)
        if (perspective) {
          const settings = dynamicTableToApi(perspective)
          const response = await apiCall('/api/perspectives/contractors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: payload.id, name: payload.newName, settings })
          })
          if (response.ok) {
            flash('Perspective renamed', 'success')
            queryClient.invalidateQueries({ queryKey: ['perspectives', 'contractors'] })
          } else {
            flash('Failed to rename perspective', 'error')
          }
        }
      },

      [TableEvents.PERSPECTIVE_DELETE]: async (payload: PerspectiveDeleteEvent) => {
        const response = await apiCall(`/api/perspectives/contractors/${payload.id}`, {
          method: 'DELETE'
        })
        if (response.ok) {
          flash('Perspective deleted', 'success')
          queryClient.invalidateQueries({ queryKey: ['perspectives', 'contractors'] })
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

  // Only show skeleton on initial load, not during refetches (e.g., when filters change)
  if (isLoading && !data) {
    return (
      <Page>
        <PageBody>
          <TableSkeleton rows={10} columns={6} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">Contractors</h1>
        </div>
        <DynamicTable
          tableRef={tableRef}
          data={tableData}
          columns={columns}
          tableName="Contractors"
          idColumnName="id"
          height={600}
          colHeaders={true}
          rowHeaders={true}
          actionsRenderer={actionsRenderer}
          uiConfig={{ hideAddRowButton: false }}
          savedPerspectives={savedPerspectives}
          activePerspectiveId={activePerspectiveId}
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
        />
        <ContractorDrawer
          contractorId={selectedContractorId}
          open={isDrawerOpen}
          onOpenChange={setIsDrawerOpen}
          onContractorUpdated={handleContractorUpdated}
        />
        <ConfirmDeleteDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open)
            if (!open) setContractorToDelete(null)
          }}
          onConfirm={handleDeleteConfirm}
          isDeleting={isDeleting}
        />
      </PageBody>
    </Page>
  )
}
