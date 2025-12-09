//@ts-nocheck

'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, Row } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

// Extend ColumnDef to support form property
type EditableColumnDef<TData, TValue = unknown> = ColumnDef<TData, TValue> & {
    form?: (context: {
        row: Row<TData>
        value: TValue
        onChange: (value: TValue) => void
    }) => React.ReactNode
}

function snakeToCamel(value: string): string {
    return value.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase())
}

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
    order?: string
    booking_number?: string
    container_number?: string
    origin_location?: string
    destination_location?: string
    etd?: string
    atd?: string
    eta?: string
    ata?: string
    status: string
    container_type?: string
    carrier_name?: string
    client?: Client | null
    createdBy?: User | null
    assignedTo?: User | null
    created_at: string
}

interface ImportResponse {
    shipmentsCreated: number
    fieldsDetected: string[]
    columnMappings: Array<{
        original: string
        mapped: string | null
        confidence: number
    }>
    metadata: {
        totalRows: number
        sheetName: string
    }
}

const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
        BOOKED: 'bg-blue-100 text-blue-800',
        DEPARTED: 'bg-purple-100 text-purple-800',
        IN_TRANSIT: 'bg-yellow-100 text-yellow-800',
        ARRIVED: 'bg-green-100 text-green-800',
        DELIVERED: 'bg-gray-100 text-gray-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
}

const formatDate = (date?: string) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString()
}

export default function ShipmentsPage() {
    const queryClient = useQueryClient()
    const [page, setPage] = useState(1)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [showImport, setShowImport] = useState(false)

    const queryParams = React.useMemo(() => {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        if (statusFilter !== 'all') params.set('status', statusFilter)
        return params.toString()
    }, [page, search, statusFilter])

    const { data, isLoading } = useQuery({
        queryKey: ['shipments', queryParams],
        queryFn: async () => {
            const call = await apiCall<{ items: Shipment[]; total: number; totalPages?: number }>(`/api/shipments?${queryParams}`)
            if (!call.ok) throw new Error('Failed to load shipments')
            return call.result ?? { items: [], total: 0, totalPages: 1 }
        }
    })

    const importMutation = useMutation({
        mutationFn: async (file: File) => {
            const formData = new FormData()
            formData.append('file', file)
            const call = await apiCall<ImportResponse>('/api/shipments/shipments/import', {
                method: 'POST',
                body: formData
            })
            if (!call.ok) throw new Error('Failed to import shipments')
            return call.result
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['shipments'] })
            flash(`Created ${data?.shipmentsCreated} shipments`, 'success')
            setSelectedFile(null)
            setShowImport(false)
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        }
    })

    const updateMutation = useMutation({
        mutationFn: async ({ id, changes }: { id: string; changes: Partial<Shipment> }) => {
            const call = await apiCall(`/api/shipments/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changes)
            })
            if (!call.ok) throw new Error('Failed to update shipment')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipments'] })
            flash('Shipment updated', 'success')
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        }
    })

    const handleImport = () => {
        if (selectedFile) {
            importMutation.mutate(selectedFile)
        }
    }

    const columns = React.useMemo<EditableColumnDef<Shipment>[]>(() => [
        {
            accessorKey: 'internal_reference',
            header: 'Reference',
            cell: ({ row }) => (
                <Link href={`/backend/shipments/${row.original.id}`} className="text-blue-600 hover:text-blue-800 hover:underline">
                    <div className="text-sm font-medium">
                        {row.original.internal_reference || '-'}
                    </div>
                    <div className="text-sm text-gray-500">
                        {row.original.booking_number || ''}
                    </div>
                </Link>
            ),
            form: ({ value, onChange }) => (
                <input
                    type="text"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                    placeholder="Reference"
                    autoFocus
                />
            ),
            meta: { priority: 1 },
        },
        {
            accessorKey: 'container_number',
            header: 'Container',
            cell: ({ row }) => (
                <div>
                    <div className="text-sm text-gray-900">
                        {row.original.container_number || '-'}
                    </div>
                    <div className="text-xs text-gray-500">
                        {row.original.container_type || ''}
                    </div>
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
            meta: { priority: 2 },
        },
        {
            accessorKey: 'client',
            header: 'Client',
            cell: ({ row }) => (
                <div>
                    <div className="text-sm text-gray-900">
                        {row.original.client?.display_name || row.original.client || '-'}
                    </div>
                    {row.original.client?.primary_email && (
                        <div className="text-xs text-gray-500">
                            {row.original.client.primary_email}
                        </div>
                    )}
                </div>
            ),
            meta: { priority: 3 },
        },
        {
            accessorKey: 'origin_location',
            header: 'Route',
            cell: ({ row }) => (
                <div>
                    <div className="text-sm text-gray-900">
                        {row.original.origin_location || '-'}
                    </div>
                    <div className="text-xs text-gray-500">
                        → {row.original.destination_location || '-'}
                    </div>
                </div>
            ),
            form: ({ value, onChange }) => (
                <input
                    type="text"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                    placeholder="Origin"
                />
            ),
            meta: { priority: 4 },
        },
        {
            accessorKey: 'carrier_name',
            header: 'Carrier',
            cell: ({ getValue }) => (
                <div className="text-sm text-gray-900">
                    {getValue<string>() || '-'}
                </div>
            ),
            form: ({ value, onChange }) => (
                <input
                    type="text"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                    placeholder="Carrier"
                />
            ),
            meta: { priority: 5 },
        },
        {
            accessorKey: 'etd',
            header: 'ETD / ETA',
            cell: ({ row }) => (
                <div>
                    <div className="text-sm text-gray-900">
                        {formatDate(row.original.etd)}
                    </div>
                    <div className="text-xs text-gray-500">
                        {formatDate(row.original.eta)}
                    </div>
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
            meta: { priority: 6 },
        },
        {
            accessorKey: 'status',
            header: 'Status',
            cell: ({ getValue }) => {
                const status = getValue<string>()
                return (
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(status)}`}>
                        {status}
                    </span>
                )
            },
            form: ({ value, onChange }) => (
                <select
                    value={value ?? 'BOOKED'}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm"
                >
                    <option value="BOOKED">Booked</option>
                    <option value="DEPARTED">Departed</option>
                    <option value="IN_TRANSIT">In Transit</option>
                    <option value="ARRIVED">Arrived</option>
                    <option value="DELIVERED">Delivered</option>
                </select>
            ),
            meta: { priority: 2 },
        },
        {
            accessorKey: 'createdBy',
            header: 'Created By',
            cell: ({ row }) => (
                <div>
                    <div className="text-sm text-gray-900">
                        {row.original.createdBy?.display_name || row.original.createdBy?.email || '-'}
                    </div>
                    {row.original.assignedTo && (
                        <div className="text-xs text-gray-500">
                            Assigned: {row.original.assignedTo.display_name || row.original.assignedTo.email}
                        </div>
                    )}
                </div>
            ),
            meta: { priority: 7 },
        },
    ], [])

    const rows = data?.items ?? []
    const total = data?.total ?? 0
    const totalPages = data?.totalPages ?? 1

    return (
        <Page>
            <PageBody>
                {showImport && (
                    <div className="bg-white shadow rounded-lg p-6 mb-6">
                        <h2 className="text-lg font-semibold mb-4">Import Shipments from Excel</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">
                                    Select Excel File (.xlsx, .xls)
                                </label>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                    className="block w-full text-sm text-gray-500
                                        file:mr-4 file:py-2 file:px-4
                                        file:rounded file:border-0
                                        file:text-sm file:font-semibold
                                        file:bg-blue-50 file:text-blue-700
                                        hover:file:bg-blue-100"
                                />
                            </div>
                            {selectedFile && (
                                <div className="text-sm text-gray-600">
                                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                                </div>
                            )}
                            <div className="flex gap-3">
                                <Button
                                    onClick={handleImport}
                                    disabled={!selectedFile || importMutation.isPending}
                                >
                                    {importMutation.isPending ? 'Importing...' : 'Import'}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setShowImport(false)
                                        setSelectedFile(null)
                                        importMutation.reset()
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <DataTable
                    title="Container Shipments"
                    actions={
                        <div className="flex gap-3">
                            <Button variant="outline" onClick={() => setShowImport(!showImport)}>
                                Import Excel
                            </Button>
                            <Button asChild>
                                <Link href="/backend/shipments/create">Create Shipment</Link>
                            </Button>
                        </div>
                    }
                    columns={columns}
                    data={rows}
                    searchValue={search}
                    searchPlaceholder="Search shipments"
                    onSearchChange={(value) => { setSearch(value); setPage(1) }}

                    filters={[
                        {
                            id: 'status',
                            label: 'Status',
                            type: 'select',
                            options: [
                                { value: 'all', label: 'All' },
                                { value: 'BOOKED', label: 'Booked' },
                                { value: 'DEPARTED', label: 'Departed' },
                                { value: 'IN_TRANSIT', label: 'In Transit' },
                                { value: 'ARRIVED', label: 'Arrived' },
                                { value: 'DELIVERED', label: 'Delivered' },
                            ],
                        },
                    ]}
                    filterValues={statusFilter === 'all' ? {} : { status: statusFilter }}
                    onFiltersApply={(vals) => {
                        setStatusFilter((vals.status as string) || 'all')
                        setPage(1)
                    }}
                    onFiltersClear={() => {
                        setStatusFilter('all')
                        setPage(1)
                    }}
                    perspective={{ tableId: 'shipments.list' }}
                    rowActions={(row) => (
                        <RowActions
                            items={[
                                { label: 'View', href: `/backend/shipments/${row.id}` },
                                { label: 'Edit', href: `/backend/shipments/${row.id}` },
                            ]}
                        />
                    )}
                    editable={true}
                    onRowSave={async (row, changes) => {
                        const diff: Partial<Shipment> = {}

                        for (const key in changes) {
                            const typedKey = key as keyof Shipment
                            if (changes[typedKey] !== row[typedKey]) {
                                const camelKey = snakeToCamel(key) as keyof Shipment
                                diff[camelKey] = changes[typedKey] as any
                            }
                        }

                        console.log('Row changes detected:', diff)
                        if (Object.keys(diff).length > 0) {
                            await updateMutation.mutateAsync({ id: row.id, changes: diff })
                        }
                    }}
                    pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
                    isLoading={isLoading}
                />
            </PageBody>
        </Page>
    )
}