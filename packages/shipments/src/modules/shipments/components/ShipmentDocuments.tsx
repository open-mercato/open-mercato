//@ts-nocheck

'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Upload, FileText, Check, X, Eye } from 'lucide-react'
import { Button } from '@open-mercato/ui'

interface ShipmentDocument {
    id: string
    shipmentId: string
    attachmentId: string
    extractedData?: Record<string, any>
    processedAt?: string
    createdAt: string
    attachment?: {
        id: string
        fileName: string
        mimeType: string
        fileSize: number
        url: string
    }
}

interface ShipmentDocumentsProps {
    shipmentId: string
}

const formatDate = (date?: string) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString()
}

const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function ShipmentDocuments({ shipmentId }: ShipmentDocumentsProps) {
    const queryClient = useQueryClient()
    const [isUploading, setIsUploading] = React.useState(false)
    const [viewingDoc, setViewingDoc] = React.useState<ShipmentDocument | null>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)

    const { data, isLoading } = useQuery({
        queryKey: ['shipment-documents', shipmentId],
        queryFn: async () => {
            const call = await apiCall<{ items: ShipmentDocument[] }>(
                `/api/shipments/${shipmentId}/documents`
            )
            if (!call.ok) throw new Error('Failed to load documents')
            return call.result?.items ?? []
        },
    })

    const uploadMutation = useMutation({
        mutationFn: async (formData: FormData) => {
            const call = await apiCall(`/api/shipments/${shipmentId}/documents`, {
                method: 'POST',
                body: formData,
            })
            if (!call.ok) throw new Error(call.error?.message || 'Failed to upload document')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipment-documents', shipmentId] })
            flash('Document uploaded and extracted successfully', 'success')
            setIsUploading(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
            setIsUploading(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    })

    const applyMutation = useMutation({
        mutationFn: async ({ docId, data }: { docId: string; data: Record<string, any> }) => {
            const call = await apiCall(`/api/shipments/documents/${docId}/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
            })
            if (!call.ok) throw new Error('Failed to apply data')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipment-containers', shipmentId] })
            flash('Data applied to shipment', 'success')
            setViewingDoc(null)
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        },
    })

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        const formData = new FormData()
        formData.append('file', file)

        await uploadMutation.mutateAsync(formData)
    }

    const columns = React.useMemo<ColumnDef<ShipmentDocument>[]>(
        () => [
            {
                accessorKey: 'attachment.fileName',
                header: 'File',
                cell: ({ row }) => (
                    <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <div>
                            <button
                                onClick={() => setViewingDoc(row.original)}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800 text-left"
                            >
                                {row.original.attachment?.fileName || 'Unknown'}
                            </button>
                            <div className="text-xs text-gray-500">
                                {row.original.attachment?.fileSize
                                    ? formatFileSize(row.original.attachment.fileSize)
                                    : '-'}
                            </div>
                        </div>
                    </div>
                ),
            },
            {
                accessorKey: 'createdAt',
                header: 'Uploaded',
                cell: ({ getValue }) => (
                    <div className="text-sm text-gray-900">
                        {formatDate(getValue<string>())}
                    </div>
                ),
            },
            {
                accessorKey: 'processedAt',
                header: 'Processed',
                cell: ({ getValue, row }) => {
                    const processed = getValue<string>()
                    const hasData = row.original.extractedData && Object.keys(row.original.extractedData).length > 0
                    return (
                        <div className="flex items-center gap-2">
                            {processed ? (
                                <>
                                    {hasData ? (
                                        <Check className="w-4 h-4 text-green-500" />
                                    ) : (
                                        <X className="w-4 h-4 text-red-500" />
                                    )}
                                    <span className="text-sm text-gray-900">
                                        {formatDate(processed)}
                                    </span>
                                </>
                            ) : (
                                <span className="text-sm text-gray-400">Pending</span>
                            )}
                        </div>
                    )
                },
            },
            {
                id: 'actions',
                header: 'Actions',
                cell: ({ row }) => (
                    <div className="flex gap-2">
                        {row.original.extractedData && (
                            <button
                                onClick={() => setViewingDoc(row.original)}
                                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                            >
                                <Eye className="w-4 h-4" />
                                Review
                            </button>
                        )}
                        {row.original.attachment?.url && (
                            <a
                                href={row.original.attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-gray-600 hover:text-gray-800"
                            >
                                Download
                            </a>
                        )}
                    </div>
                ),
            },
        ],
        []
    )

    return (
        <div className="space-y-4">
            <div className="flex justify-end items-end">
                <div>
                    <div />
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                    <Button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoading || isUploading}
                        size="sm"
                    >
                        <Upload className="w-4 h-4 mr-2" />
                        {isUploading ? 'Processing...' : 'Upload Document'}
                    </Button>
                </div>
            </div>

            <div className="bg-white rounded-lg border">
                <DataTable
                    columns={columns}
                    data={data ?? []}
                    isLoading={isLoading}
                    perspective={{ tableId: 'shipment.documents' }}
                />
            </div>

            {/* Review Dialog */}
            {viewingDoc && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">
                            Extracted Data
                        </h3>

                        <div className="space-y-3">
                            {viewingDoc.extractedData && Object.entries(viewingDoc.extractedData).map(([key, value]) => (
                                <div key={key} className="grid grid-cols-3 gap-4 py-2 border-b">
                                    <div className="text-sm font-medium text-gray-700">
                                        {key.replace(/([A-Z])/g, ' $1').trim()}
                                    </div>
                                    <div className="col-span-2 text-sm text-gray-900">
                                        {value !== null && value !== undefined ? String(value) : '-'}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setViewingDoc(null)}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Close
                            </button>
                            {/* <button
                                onClick={() => {
                                    if (viewingDoc.extractedData) {
                                        applyMutation.mutate({
                                            docId: viewingDoc.id,
                                            data: viewingDoc.extractedData,
                                        })
                                    }
                                }}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                            >
                                Apply to Shipment
                            </button> */}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}