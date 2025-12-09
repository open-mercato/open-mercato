//@ts-nocheck

'use client'

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Plus, Trash2 } from 'lucide-react'
import { Button, RowActions } from '@open-mercato/ui'
import { SearchableSelect } from './SearchableSelect'

type EditableColumnDef<TData, TValue = unknown> = ColumnDef<TData, TValue> & {
    form?: (context: {
        row: any
        value: TValue
        onChange: (value: TValue) => void
    }) => React.ReactNode
}

interface ShipmentTask {
    id: string
    title: string
    description?: string
    status: 'TODO' | 'IN_PROGRESS' | 'DONE'
    createdAt: string
    updatedAt: string
}

interface ShipmentTasksProps {
    shipmentId: string
}

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const

const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
        TODO: 'bg-gray-100 text-gray-800',
        IN_PROGRESS: 'bg-blue-100 text-blue-800',
        DONE: 'bg-green-100 text-green-800',
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
}

export function ShipmentTasks({ shipmentId }: ShipmentTasksProps) {
    const queryClient = useQueryClient()
    const [isAdding, setIsAdding] = React.useState(false)
    const [newTask, setNewTask] = React.useState({ title: '', description: '', status: 'TODO', assignedToId: null })

    const { data, isLoading } = useQuery({
        queryKey: ['shipment-tasks', shipmentId],
        queryFn: async () => {
            const call = await apiCall<{ items: ShipmentTask[] }>(
                `/api/shipments/${shipmentId}/tasks`
            )
            if (!call.ok) throw new Error('Failed to load tasks')
            return call.result?.items ?? []
        },
    })

    const createMutation = useMutation({
        mutationFn: async (task: { title: string; description?: string; status: string }) => {
            const call = await apiCall(`/api/shipments/${shipmentId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(task),
            })
            if (!call.ok) throw new Error('Failed to create task')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipment-tasks', shipmentId] })
            flash('Task created', 'success')
            setIsAdding(false)
            setNewTask({ title: '', description: '', status: 'TODO' })
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        },
    })

    const updateMutation = useMutation({
        mutationFn: async ({ id, changes }: { id: string; changes: Partial<ShipmentTask> }) => {
            const call = await apiCall(`/api/shipments/${shipmentId}/tasks/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changes),
            })
            if (!call.ok) throw new Error('Failed to update task')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipment-tasks', shipmentId] })
            flash('Task updated', 'success')
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        },
    })

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const call = await apiCall(`/api/shipments/tasks/${id}`, {
                method: 'DELETE',
            })
            if (!call.ok) throw new Error('Failed to delete task')
            return call.result
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['shipment-tasks', shipmentId] })
            flash('Task deleted', 'success')
        },
        onError: (error: Error) => {
            flash(error.message, 'error')
        },
    })

    const columns = React.useMemo<EditableColumnDef<ShipmentTask>[]>(
        () => [
            {
                accessorKey: 'title',
                header: 'Title',
                cell: ({ getValue }) => (
                    <div className="text-sm font-medium text-gray-900">
                        {getValue<string>()}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <input
                        type="text"
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="Task title"
                    />
                ),
            },
            {
                accessorKey: 'description',
                header: 'Description',
                cell: ({ getValue }) => (
                    <div className="text-sm text-gray-600">
                        {getValue<string>() || '-'}
                    </div>
                ),
                form: ({ value, onChange }) => (
                    <textarea
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="Description"
                        rows={2}
                    />
                ),
            },
            {
                accessorKey: 'status',
                header: 'Status',
                cell: ({ getValue }) => {
                    const status = getValue<string>()
                    return (
                        <span
                            className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(status)}`}
                        >
                            {status.replace(/_/g, ' ')}
                        </span>
                    )
                },
                form: ({ value, onChange }) => (
                    <select
                        value={value ?? 'TODO'}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                    >
                        {TASK_STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {status.replace(/_/g, ' ')}
                            </option>
                        ))}
                    </select>
                ),
            },

            {
                accessorKey: 'assignedTo',
                header: 'Assigned To',
                cell: ({ getValue }) => {
                    const user = getValue<any>()
                    return (
                        <div className="text-sm text-gray-900">
                            {user?.displayName || user?.email || '-'}
                        </div>
                    )
                },
            },

        ],
        []
    )

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button
                    onClick={() => setIsAdding(true)}
                    size="sm"
                    disabled={isAdding}
                >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Task
                </Button>
            </div>

            {isAdding && (
                <div className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Title
                        </label>
                        <input
                            type="text"
                            value={newTask.title}
                            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                            placeholder="Enter task title"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Description
                        </label>
                        <textarea
                            value={newTask.description}
                            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                            placeholder="Enter description (optional)"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                            rows={3}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Status
                            </label>
                            <select
                                value={newTask.status}
                                onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                            >
                                {TASK_STATUSES.map((status) => (
                                    <option key={status} value={status}>
                                        {status.replace(/_/g, ' ')}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Assign To
                            </label>
                            <SearchableSelect
                                endpoint="/api/shipments/entities/user"
                                value={newTask.assignedToId || ''}
                                onChange={(val) => setNewTask({ ...newTask, assignedToId: val })}
                                labelKey="email"
                                valueKey="id"
                                defaultLimit={50}
                                placeholder="Select user (optional)"
                                className="w-full"
                                autoOpen={false}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2 border-t">
                        <Button
                            onClick={() => {
                                setIsAdding(false)
                                setNewTask({ title: '', description: '', status: 'TODO', assignedToId: null })
                            }}
                            variant="outline"
                            size="sm"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => createMutation.mutate(newTask)}
                            disabled={!newTask.title.trim()}
                            size="sm"
                        >
                            Create Task
                        </Button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg border">
                <DataTable
                    columns={columns}
                    data={data ?? []}
                    isLoading={isLoading}
                    perspective={{ tableId: 'shipment.tasks' }}
                    editable={true}
                    rowActions={(row) => (
                        <RowActions
                            items={[
                                {
                                    label: 'Delete',
                                    onClick: () => {
                                        if (confirm('Delete this task?')) {
                                            deleteMutation.mutate(row.id)
                                        }
                                    },
                                    icon: Trash2,
                                },
                            ]}
                        />
                    )}
                    onRowSave={async (row, changes) => {
                        const diff: Partial<ShipmentTask> = {}
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
        </div>
    )
}