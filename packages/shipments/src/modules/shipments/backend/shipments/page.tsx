//@ts-nocheck
'use client'

import * as React from 'react'
import { useState, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import Table from '@open-mercato/ui/backend/tables'
import { TableEvents } from '@open-mercato/ui/backend/tables/events/types'
import { dispatch, useMediator } from '@open-mercato/ui/backend/tables/events/events'
import {
    CellEditSaveEvent,
    CellSaveStartEvent,
    CellSaveSuccessEvent,
    CellSaveErrorEvent,
    NewRowSaveEvent,
    NewRowSaveSuccessEvent,
    NewRowSaveErrorEvent
} from '@open-mercato/ui/backend/tables/events/types'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

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

export default function ShipmentsPage() {
    const tableRef = useRef<HTMLDivElement>(null)
    const queryClient = useQueryClient()
    const [page, setPage] = useState(1)

    const queryParams = React.useMemo(() => {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '90')
        return params.toString()
    }, [page])

    const { data, isLoading } = useQuery({
        queryKey: ['shipments', queryParams],
        queryFn: async () => {
            const call = await apiCall<{ items: Shipment[]; total: number; totalPages?: number }>(`/api/shipments?${queryParams}`)
            if (!call.ok) throw new Error('Failed to load shipments')
            return call.result ?? { items: [], total: 0, totalPages: 1 }
        }
    })

    // Flatten nested objects for display
    const tableData = React.useMemo(() => {
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

    // Handle cell edits
    useMediator<CellEditSaveEvent>(
        TableEvents.CELL_EDIT_SAVE,
        useCallback(async (payload: CellEditSaveEvent) => {
            console.log('CELL_EDIT_SAVE event received:', payload)

            dispatch(
                tableRef.current as HTMLElement,
                TableEvents.CELL_SAVE_START,
                {
                    rowIndex: payload.rowIndex,
                    colIndex: payload.colIndex,
                } as CellSaveStartEvent
            )

            console.log('payload: field', { [payload.prop]: payload.newValue })

            try {

                console.log("saving event", {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [payload.prop]: payload.newValue })
                })
                const response = await apiCall(`/api/shipments/${payload.id}`, {
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
                console.error('Save exception', error)
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
        }, [tableData, queryClient]),
        tableRef as React.RefObject<HTMLElement>
    )

    useMediator<NewRowSaveEvent>(
        TableEvents.NEW_ROW_SAVE,
        useCallback(async (payload: NewRowSaveEvent) => {
            console.log('NEW_ROW_SAVE event received:', payload)
            // Filter out empty string values from rowData
            const filteredRowData = Object.fromEntries(
                Object.entries(payload.rowData).filter(([_, value]) => value !== '')
            )
            try {
                const response = await apiCall(`/api/shipments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(filteredRowData)
                })

                if (response.ok) {
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
                console.error('Save exception', error)
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
        }, [tableData, queryClient]),
        tableRef as React.RefObject<HTMLElement>
    )

    const columns = React.useMemo(() => [
        {
            data: 'internalReference',
            width: 150,
            title: 'Internal Ref'
        },
        {
            data: 'bookingNumber',
            width: 150,
            title: 'Booking #'
        },
        {
            data: 'bolNumber',
            width: 150,
            title: 'BOL #'
        },
        {
            data: 'status',
            width: 150,
            title: 'Status',
            renderer: (value: string) => <StatusRenderer value={value} />
        },
        {
            data: 'clientName',
            width: 180,
            title: 'Client',
            readOnly: true
        },
        {
            data: 'clientEmail',
            width: 200,
            title: 'Client Email',
            readOnly: true
        },
        {
            data: 'carrier',
            width: 150,
            title: 'Carrier'
        },
        {
            data: 'originLocation',
            width: 150,
            title: 'Origin Location'
        },
        {
            data: 'destinationLocation',
            width: 150,
            title: 'Dest. Location'
        },
        {
            data: 'etd',
            width: 120,
            title: 'ETD',
            type: 'date',
            dateFormat: 'dd/MM/yyyy'
        },
        {
            data: 'atd',
            width: 120,
            title: 'ATD',
            type: 'date',
            dateFormat: 'dd/MM/yyyy'
        },
        {
            data: 'eta',
            width: 120,
            title: 'ETA',
            type: 'date',
            dateFormat: 'dd/MM/yyyy'
        },
        {
            data: 'ata',
            width: 120,
            title: 'ATA',
            type: 'date',
            dateFormat: 'dd/MM/yyyy'
        },
        {
            data: 'mode',
            width: 100,
            title: 'Mode'
        },
        {
            data: 'incoterms',
            width: 100,
            title: 'Incoterms'
        },
        {
            data: 'weight',
            width: 100,
            title: 'Weight',
            type: 'numeric'
        },
        {
            data: 'volume',
            width: 100,
            title: 'Volume',
            type: 'numeric'
        },
        {
            data: 'total_pieces',
            width: 100,
            title: 'Pieces',
            type: 'numeric'
        },
        {
            data: 'totalVolume',
            width: 120,
            title: 'Total Volume',
            type: 'numeric'
        },
        {
            data: 'amount',
            width: 120,
            title: 'Amount',
            type: 'numeric'
        },
        {
            data: 'requestDate',
            width: 120,
            title: 'Request Date',
            type: 'date',
            dateFormat: 'dd/MM/yyyy'
        },
        {
            data: 'createdAt',
            width: 120,
            title: 'Created',
            type: 'date',
            dateFormat: 'dd/MM/yyyy',
            readOnly: true
        },
        {
            data: 'updatedAt',
            width: 120,
            title: 'Updated',
            type: 'date',
            dateFormat: 'dd/MM/yyyy',
            readOnly: true
        },
    ], [])

    if (isLoading) {
        return (
            <Page>
                <PageBody>
                    <div className="flex items-center justify-center h-64">
                        <div className="text-gray-500">Loading shipments...</div>
                    </div>
                </PageBody>
            </Page>
        )
    }

    return (
        <Page>
            <PageBody>
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h1 className="text-2xl font-bold">Container Shipments</h1>
                        <div className="text-sm text-gray-500">
                            {data?.total || 0} shipments
                        </div>
                    </div>

                    <Table
                        tableRef={tableRef}
                        data={tableData}
                        columns={columns}
                        colHeaders={true}
                        rowHeaders={true}
                        height="auto"
                        width="100%"
                    />
                </div>
            </PageBody>
        </Page>
    )
}