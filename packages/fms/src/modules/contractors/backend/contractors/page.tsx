'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
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
} from '@open-mercato/ui/backend/dynamic-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { ContractorDrawer } from '../../components/ContractorDrawer'

type ContractorRow = {
  id: string
  name: string
  shortName?: string | null
  code?: string | null
  taxId?: string | null
  legalName?: string | null
  isActive: boolean
  createdAt?: string
}

type ContractorsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function mapApiItem(item: Record<string, unknown>): ContractorRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    shortName: typeof item.shortName === 'string' ? item.shortName : null,
    code: typeof item.code === 'string' ? item.code : null,
    taxId: typeof item.taxId === 'string' ? item.taxId : null,
    legalName: typeof item.legalName === 'string' ? item.legalName : null,
    isActive: item.isActive === true,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
  }
}

// Global ref to store the contractor click handler
let onContractorClickHandler: ((contractorId: string) => void) | null = null

export function setContractorClickHandler(handler: ((contractorId: string) => void) | null) {
  onContractorClickHandler = handler
}

const ContractorNameRenderer = ({ value, rowData }: { value: string; rowData: { id: string } }) => {
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
      {value || '-'}
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
    width: 180,
    renderer: (value: string, rowData: { id: string }) => <ContractorNameRenderer value={value} rowData={rowData} />,
  },
  { data: 'code', title: 'Code', type: 'text', width: 100 },
  { data: 'shortName', title: 'Short Name', type: 'text', width: 120 },
  { data: 'taxId', title: 'Tax ID', type: 'text', width: 120 },
  { data: 'legalName', title: 'Legal Name', type: 'text', width: 180 },
  {
    data: 'isActive',
    title: 'Status',
    type: 'boolean',
    width: 80,
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

  // Register the contractor click handler for the renderer
  useEffect(() => {
    setContractorClickHandler((contractorId: string) => {
      setSelectedContractorId(contractorId)
      setIsDrawerOpen(true)
    })
    return () => setContractorClickHandler(null)
  }, [])

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(limit))
    params.set('sortField', sortField)
    params.set('sortDir', sortDir)
    if (search) params.set('search', search)
    return params.toString()
  }, [page, limit, sortField, sortDir, search])

  const { data, isLoading } = useQuery({
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
  })

  const tableData = useMemo(() => {
    return (data?.items ?? []).map((contractor) => ({
      id: contractor.id,
      name: contractor.name,
      shortName: contractor.shortName ?? '',
      code: contractor.code ?? '',
      taxId: contractor.taxId ?? '',
      legalName: contractor.legalName ?? '',
      isActive: contractor.isActive,
      createdAt: contractor.createdAt ?? '',
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
          const response = await apiCall<{ error?: string }>(`/api/contractors/contractors/${payload.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [payload.prop]: payload.newValue === '' ? null : payload.newValue }),
          })

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
        const filteredRowData = Object.fromEntries(
          Object.entries(payload.rowData).filter(([_, value]) => value !== '')
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
    },
    tableRef as React.RefObject<HTMLElement>
  )

  if (isLoading) {
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
          columns={COLUMNS}
          tableName="Contractors"
          idColumnName="id"
          height={600}
          colHeaders={true}
          rowHeaders={true}
          uiConfig={{ hideAddRowButton: false }}
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
      </PageBody>
    </Page>
  )
}
