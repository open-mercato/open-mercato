'use client'

import * as React from 'react'
import { useState, useMemo, useRef } from 'react'
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
} from '@open-mercato/ui/backend/dynamic-table'
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

export default function ShipmentsPage() {
    const tableRef = useRef<HTMLDivElement>(null)
    const queryClient = useQueryClient()

    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(50)
    const [sortField, setSortField] = useState('createdAt')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
    const [search, setSearch] = useState('')
    const [filters, setFilters] = useState<FilterRow[]>([])

    const { data: tableConfig, isLoading: configLoading } = useTableConfig('shipments')

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
