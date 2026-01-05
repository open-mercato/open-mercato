'use client'

import * as React from 'react'
import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
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

interface Client {
    id: string
    display_name?: string
    primary_email?: string
}

interface User {
    id: string
    email?: string
    display_name?: string
}

interface Shipment {
    id: string
    internal_reference?: string
    client_reference?: string
    booking_number?: string
    bol_number?: string
    container_number?: string
    container_type?: string
    carrier?: string
    origin_port?: string
    origin_location?: string
    destination_port?: string
    destination_location?: string
    etd?: string
    atd?: string
    eta?: string
    ata?: string
    weight?: number
    volume?: number
    total_pieces?: number
    total_actual_weight?: number
    total_chargeable_weight?: number
    total_volume?: number
    actual_weight_per_kilo?: number
    amount?: number
    mode?: string
    vessel_name?: string
    vessel_imo?: string
    voyage_number?: string
    status: string
    incoterms?: string
    request_date?: string
    client?: Client | null
    shipper?: Client | null
    consignee?: Client | null
    contact_person?: Client | null
    createdBy?: User | null
    assignedTo?: User | null
    created_at: string
    updated_at: string
}

const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
        ORDERED: 'bg-gray-100 text-gray-800',
        BOOKED: 'bg-blue-100 text-blue-800',
        LOADING: 'bg-indigo-100 text-indigo-800',
        DEPARTED: 'bg-purple-100 text-purple-800',
        TRANSSHIPMENT: 'bg-yellow-100 text-yellow-800',
        PRE_ARRIVAL: 'bg-orange-100 text-orange-800',
        IN_PORT: 'bg-cyan-100 text-cyan-800',
        DELIVERED: 'bg-green-100 text-green-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
}

const StatusRenderer = ({ value }: { value: string }) => {
    if (!value) return <span>-</span>
    return (
        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(value)}`}>
            {value.replace(/_/g, ' ')}
        </span>
    )
}

const RENDERERS: Record<string, (value: any, rowData: any) => React.ReactNode> = {
    StatusRenderer: (value) => <StatusRenderer value={value} />,
}

// Transform API perspective format to DynamicTable format
function apiToDynamicTable(dto: PerspectiveDto, allColumns: string[]): PerspectiveConfig {
    const { columnOrder = [], columnVisibility = {} } = dto.settings

    // Visible = columns in order that aren't explicitly hidden
    const visible = columnOrder.length > 0
        ? columnOrder.filter(col => columnVisibility[col] !== false)
        : allColumns
    const hidden = allColumns.filter(col => !visible.includes(col))

    // Filters: API stores as { rows: FilterRow[], _color?: string }
    const apiFilters = dto.settings.filters as Record<string, unknown> | undefined
    const filters: FilterRow[] = Array.isArray(apiFilters)
        ? apiFilters as FilterRow[]
        : (apiFilters?.rows as FilterRow[]) ?? []
    // Color is stored inside filters object to bypass Zod stripping
    const color = apiFilters?._color as PerspectiveConfig['color']

    // Sorting: API uses { id, desc }, DynamicTable uses { id, field, direction }
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
        // Store color inside filters object to bypass Zod stripping unknown fields
        filters: { rows: config.filters, _color: config.color },
        sorting: config.sorting.map(s => ({
            id: s.field,
            desc: s.direction === 'desc'
        })),
    }
}

export default function ShipmentsPage() {
    const tableRef = useRef<HTMLDivElement>(null)
    const queryClient = useQueryClient()

    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(50)
    const [sortField, setSortField] = useState('createdAt')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
    const [search, setSearch] = useState('')
    const [filters, setFilters] = useState<FilterRow[]>([])

    // Perspective state
    const [savedPerspectives, setSavedPerspectives] = useState<PerspectiveConfig[]>([])
    const [activePerspectiveId, setActivePerspectiveId] = useState<string | null>(null)

    const { data: tableConfig, isLoading: configLoading } = useTableConfig('shipments')

    // Fetch perspectives
    const { data: perspectivesData } = useQuery({
        queryKey: ['perspectives', 'shipments'],
        queryFn: async () => {
            const response = await apiCall<PerspectivesIndexResponse>('/api/perspectives/shipments')
            return response.ok ? response.result : null
        }
    })

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

    const { data, isLoading: dataLoading } = useQuery({
        queryKey: ['shipments', queryParams],
        queryFn: async () => {
            const call = await apiCall<{ items: Shipment[]; total: number; totalPages?: number }>(`/api/shipments?${queryParams}`)
            if (!call.ok) throw new Error('Failed to load shipments')
            return call.result ?? { items: [], total: 0, totalPages: 1 }
        }
    })

    const tableData = useMemo(() => {
        return (data?.items ?? []).map(shipment => {
            const camelCaseObject: Record<string, any> = { id: shipment.id }

            Object.keys(shipment).forEach(key => {
                if (key === 'id') return

                const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
                const value = shipment[key as keyof Shipment]

                if (value && typeof value === 'object' && 'display_name' in value) {
                    camelCaseObject[`${camelKey}Name`] = value.display_name
                    if ('primary_email' in value) {
                        camelCaseObject[`${camelKey}Email`] = value.primary_email
                    }
                } else {
                    camelCaseObject[camelKey] = value
                }
            })

            return camelCaseObject
        })
    }, [data?.items])

    const columns = useMemo((): ColumnDef[] => {
        if (!tableConfig?.columns) return []
        return tableConfig.columns.map(col => ({
            ...col,
            // Map 'checkbox' type from backend to 'boolean' for DynamicTable
            type: col.type === 'checkbox' ? 'boolean' : col.type,
            renderer: col.renderer ? RENDERERS[col.renderer] : undefined,
        })) as ColumnDef[]
    }, [tableConfig])

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

    useEventHandlers({
        [TableEvents.CELL_EDIT_SAVE]: async (payload: CellEditSaveEvent) => {
            dispatch(
                tableRef.current as HTMLElement,
                TableEvents.CELL_SAVE_START,
                {
                    rowIndex: payload.rowIndex,
                    colIndex: payload.colIndex,
                } as CellSaveStartEvent
            )

            try {
                const response = await apiCall<{ error?: string }>(`/api/shipments/${payload.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [payload.prop]: payload.newValue })
                })

                if (response.ok) {
                    flash('Shipment updated', 'success')
                    dispatch(
                        tableRef.current as HTMLElement,
                        TableEvents.CELL_SAVE_SUCCESS,
                        {
                            rowIndex: payload.rowIndex,
                            colIndex: payload.colIndex,
                        } as CellSaveSuccessEvent
                    )
                } else {
                    const error = response.result?.error || 'Update failed'
                    flash(error, 'error')
                    dispatch(
                        tableRef.current as HTMLElement,
                        TableEvents.CELL_SAVE_ERROR,
                        {
                            rowIndex: payload.rowIndex,
                            colIndex: payload.colIndex,
                            error,
                        } as CellSaveErrorEvent
                    )
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                flash(errorMessage, 'error')
                dispatch(
                    tableRef.current as HTMLElement,
                    TableEvents.CELL_SAVE_ERROR,
                    {
                        rowIndex: payload.rowIndex,
                        colIndex: payload.colIndex,
                        error: errorMessage,
                    } as CellSaveErrorEvent
                )
            }
        },

        [TableEvents.NEW_ROW_SAVE]: async (payload: NewRowSaveEvent) => {
            const filteredRowData = Object.fromEntries(
                Object.entries(payload.rowData).filter(([_, value]) => value !== '')
            )

            try {
                const response = await apiCall<{ id: string; error?: string }>(`/api/shipments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(filteredRowData)
                })

                if (response.ok && response.result) {
                    flash('Shipment created', 'success')
                    dispatch(
                        tableRef.current as HTMLElement,
                        TableEvents.NEW_ROW_SAVE_SUCCESS,
                        {
                            rowIndex: payload.rowIndex,
                            savedRowData: {
                                ...payload.rowData,
                                id: response.result.id,
                            }
                        } as NewRowSaveSuccessEvent
                    )
                    queryClient.invalidateQueries({ queryKey: ['shipments'] })
                } else {
                    const error = response.result?.error || 'Creation failed'
                    flash(error, 'error')
                    dispatch(
                        tableRef.current as HTMLElement,
                        TableEvents.NEW_ROW_SAVE_ERROR,
                        {
                            rowIndex: payload.rowIndex,
                            error,
                        } as NewRowSaveErrorEvent
                    )
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                flash(errorMessage, 'error')
                dispatch(
                    tableRef.current as HTMLElement,
                    TableEvents.NEW_ROW_SAVE_ERROR,
                    {
                        rowIndex: payload.rowIndex,
                        error: errorMessage,
                    } as NewRowSaveErrorEvent
                )
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

        // Perspective event handlers
        [TableEvents.PERSPECTIVE_SAVE]: async (payload: PerspectiveSaveEvent) => {
            const settings = dynamicTableToApi(payload.perspective)
            // Check if perspective with same name exists to update it instead of creating duplicate
            const existingPerspective = savedPerspectives.find(p => p.name === payload.perspective.name)
            const response = await apiCall('/api/perspectives/shipments', {
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
                queryClient.invalidateQueries({ queryKey: ['perspectives', 'shipments'] })
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
                const response = await apiCall('/api/perspectives/shipments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: payload.id, name: payload.newName, settings })
                })
                if (response.ok) {
                    flash('Perspective renamed', 'success')
                    queryClient.invalidateQueries({ queryKey: ['perspectives', 'shipments'] })
                } else {
                    flash('Failed to rename perspective', 'error')
                }
            }
        },

        [TableEvents.PERSPECTIVE_DELETE]: async (payload: PerspectiveDeleteEvent) => {
            const response = await apiCall(`/api/perspectives/shipments/${payload.id}`, {
                method: 'DELETE'
            })
            if (response.ok) {
                flash('Perspective deleted', 'success')
                queryClient.invalidateQueries({ queryKey: ['perspectives', 'shipments'] })
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
    }, tableRef as React.RefObject<HTMLElement>)

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
                    tableName="Container Shipments"
                    idColumnName="id"
                    height={600}
                    colHeaders={true}
                    rowHeaders={true}
                    savedPerspectives={savedPerspectives}
                    activePerspectiveId={activePerspectiveId}
                    pagination={{
                        currentPage: page,
                        totalPages: Math.ceil((data?.total || 0) / limit),
                        limit,
                        limitOptions: [25, 50, 100],
                        onPageChange: setPage,
                        onLimitChange: (l) => { setLimit(l); setPage(1); },
                    }}
                    debug={process.env.NODE_ENV === 'development'}
                />
            </PageBody>
        </Page>
    )
}
