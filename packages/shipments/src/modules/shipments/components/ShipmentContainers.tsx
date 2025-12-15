//@ts-nocheck

'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RowActions } from '@open-mercato/ui'

const CONTAINER_TYPES = ['20GP', '40GP', '40HC', '45HC', '20RF', '40RF', '20OT', '40OT'] as const

type EditableColumnDef<TData, TValue = unknown> = ColumnDef<TData, TValue> & {
    form?: (context: {
        row: any
        value: TValue
        onChange: (value: TValue) => void
    }) => React.ReactNode
}

interface ShipmentContainer {
    id: string
    containerNumber: string
    containerType?: string
    cargoDescription?: string
    status?: string
    currentLocation?: string
    gateInDate?: string
    loadedOnVesselDate?: string
    dischargedDate?: string
    gateOutDate?: string
    emptyReturnDate?: string
    createdAt: string
}

const CONTAINER_STATUSES = [
    'EMPTY',
    'STUFFED',
    'GATE_IN',
    'LOADED',
    'IN_TRANSIT',
    'DISCHARGED',
    'GATE_OUT',
    'DELIVERED',
    'RETURNED'
] as const

const getContainerStatusColor = (status?: string) => {
    const colors: Record<string, string> = {
        EMPTY: 'bg-gray-100 text-gray-800',
        STUFFED: 'bg-blue-100 text-blue-800',
        GATE_IN: 'bg-yellow-100 text-yellow-800',
        LOADED: 'bg-purple-100 text-purple-800',
        IN_TRANSIT: 'bg-indigo-100 text-indigo-800',
        DISCHARGED: 'bg-orange-100 text-orange-800',
        GATE_OUT: 'bg-green-100 text-green-800',
        DELIVERED: 'bg-emerald-100 text-emerald-800',
        RETURNED: 'bg-gray-100 text-gray-800',
    }
    return status ? colors[status] || 'bg-gray-100 text-gray-800' : ''
}

const formatDate = (date?: string) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString()
}

interface ShipmentContainersProps {
    shipmentId: string
}

export function ShipmentContainers({ shipmentId }: ShipmentContainersProps) {
    const queryClient = useQueryClient()

    const { data, isLoading } = useQuery({
        queryKey: ['shipment-containers', shipmentId],
        queryFn: async () => {
            const call = await apiCall<{ items: ShipmentContainer[] }>(
                `/api/shipments/${shipmentId}/containers`
            )
            if (!call.ok) throw new Error('Failed to load containers')
            return call.result?.items ?? []
        },
    })

    const updateMutation = useMutation({
        mutationFn: async ({ id, changes }: { id: string; changes: Partial<ShipmentContainer> }) => {
            const call = await apiCall(`/api/shipments/containers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changes),
            })
            if (!call.ok) throw new Error('Failed to update container')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipment-containers', shipmentId] })
            flash('Container updated', 'success')
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        },
    })

    const columns = React.useMemo<EditableColumnDef<ShipmentContainer>[]>(
        () => [
            {
                accessorKey: 'containerNumber',
                header: 'Container',
                cell: ({ getValue }) => (
                    <div className="text-sm font-medium text-gray-900 ">
                        {getValue<string>()}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <input
                        type="text"
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="Container number"
                    />
                ),
            },
            {
                accessorKey: 'containerType',
                header: 'Type',
                cell: ({ getValue }) => (
                    <div className="text-sm text-gray-900">
                        {getValue<string>() || '-'}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <select
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                    >
                        <option value="">Select type</option>
                        {CONTAINER_TYPES.map((type) => (
                            <option key={type} value={type}>
                                {type}
                            </option>
                        ))}
                    </select>
                ),
            },
            {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ getValue }) => {
                    const status = getValue<string>()
                    return status ? (
                        <div>
                            <span
                                className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getContainerStatusColor(status)}`}
                            >
                                {status.replace(/_/g, ' ')}
                            </span>
                        </div>
                    ) : (
                        <div><span className="text-gray-400">-</span></div>
                    )
                },
                form: ({ value, onChange }) => (
                    <select
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                    >
                        <option value="">None</option>
                        {CONTAINER_STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {status.replace(/_/g, ' ')}
                            </option>
                        ))}
                    </select>
                ),
            },
            {
                accessorKey: 'loadedOnVesselDate',
                header: 'Loaded',
                cell: ({ getValue }) => (
                    <div className="text-sm text-gray-900">
                        {formatDate(getValue<string>())}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <input
                        type="date"
                        value={value ? new Date(value).toISOString().split('T')[0] : ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                    />
                ),
            },
            {
                accessorKey: 'dischargedDate',
                header: 'Discharged',
                cell: ({ getValue }) => (
                    <div className="text-sm text-gray-900">
                        {formatDate(getValue<string>())}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <input
                        type="date"
                        value={value ? new Date(value).toISOString().split('T')[0] : ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                    />
                ),
            },
            {
                accessorKey: 'gateOutDate',
                header: 'Gate Out',
                cell: ({ getValue }) => (
                    <div className="text-sm text-gray-900">
                        {formatDate(getValue<string>())}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <div>
                        <input
                            type="date"
                            value={value ? new Date(value).toISOString().split('T')[0] : ''}
                            onChange={(e) => onChange(e.target.value)}
                            className="w-full px-2 py-1 border rounded text-sm"
                        />
                    </div>
                ),
            },
        ],
        []
    )

    return (
        <div className="bg-white rounded-lg border [&_td]:!text-left [&_th]:!text-left [&_td]:!px-4 [&_th]:!px-4 [&_td]:border-r [&_th]:border-r [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
            <DataTable
                columns={columns}
                data={data ?? []}
                isLoading={isLoading}
                perspective={{ tableId: 'shipment.containers' }}
                editable={true}
                rowActions={(row) => (
                    <RowActions
                        items={[

                        ]}
                    />
                )}
                onRowSave={async (row, changes) => {
                    const diff: Partial<ShipmentContainer> = {}

                    for (const key in changes) {
                        if (changes[key] !== row[key]) {
                            diff[key] = changes[key]
                        }
                    }

                    if (Object.keys(diff).length > 0) {
                        await updateMutation.mutateAsync({ id: row.id, changes: diff })
                    }
                }}
            />
        </div>
    )
}