"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type UserTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

type UserTask = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string
  taskName: string
  description: string | null
  status: UserTaskStatus
  formSchema: any | null
  formData: any | null
  assignedTo: string | null
  assignedToRoles: string[] | null
  claimedBy: string | null
  claimedAt: string | null
  dueDate: string | null
  escalatedAt: string | null
  escalatedTo: string | null
  completedBy: string | null
  completedAt: string | null
  comments: string | null
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

type TasksResponse = {
  data: UserTask[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export default function UserTasksListPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({
    myTasks: 'true', // Default to "My Tasks" view
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-tasks', 'list', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      const offset = (page - 1) * pageSize
      params.set('limit', pageSize.toString())
      params.set('offset', offset.toString())

      if (filterValues.status) params.set('status', filterValues.status as string)
      if (filterValues.myTasks === 'true') params.set('myTasks', 'true')
      if (filterValues.overdue === 'true') params.set('overdue', 'true')
      if (filterValues.workflowInstanceId) params.set('workflowInstanceId', filterValues.workflowInstanceId as string)

      const result = await apiCall<TasksResponse>(
        `/api/workflows/tasks?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch user tasks')
      }

      const response = result.result
      if (response?.pagination) {
        setTotal(response.pagination.total || 0)
        const calculatedPages = Math.ceil((response.pagination.total || 0) / pageSize)
        setTotalPages(calculatedPages || 1)
      }

      return response?.data || []
    },
  })

  const handleClaim = async (id: string, taskName: string) => {
    if (!confirm(t('workflows.tasks.confirm.claim', { name: taskName }))) {
      return
    }

    const result = await apiCall(`/api/workflows/tasks/${id}/claim`, {
      method: 'POST',
    })

    if (result.ok) {
      flash(t('workflows.tasks.messages.claimed'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-tasks'] })
    } else {
      flash(t('workflows.tasks.messages.claimFailed'), 'error')
    }
  }

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== '') next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({ myTasks: 'true' })
    setPage(1)
  }, [])

  const getStatusBadgeClass = (status: UserTaskStatus) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800'
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-800'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'CANCELLED':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const isOverdue = (task: UserTask) => {
    if (!task.dueDate || task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      return false
    }
    return new Date(task.dueDate) < new Date()
  }

  const filters: FilterDef[] = [
    {
      id: 'status',
      type: 'select',
      label: t('workflows.tasks.filters.status'),
      options: [
        { label: t('common.all'), value: '' },
        { label: t('workflows.tasks.status.PENDING'), value: 'PENDING' },
        { label: t('workflows.tasks.status.IN_PROGRESS'), value: 'IN_PROGRESS' },
        { label: t('workflows.tasks.status.COMPLETED'), value: 'COMPLETED' },
        { label: t('workflows.tasks.status.CANCELLED'), value: 'CANCELLED' },
      ],
    },
    {
      id: 'myTasks',
      type: 'select',
      label: t('workflows.tasks.filters.view'),
      options: [
        { label: t('workflows.tasks.filters.myTasks'), value: 'true' },
        { label: t('workflows.tasks.filters.allTasks'), value: '' },
      ],
    },
    {
      id: 'overdue',
      type: 'select',
      label: t('workflows.tasks.filters.overdue'),
      options: [
        { label: t('common.all'), value: '' },
        { label: t('workflows.tasks.filters.overdueOnly'), value: 'true' },
      ],
    },
    {
      id: 'workflowInstanceId',
      type: 'text',
      label: t('workflows.tasks.filters.workflowInstanceId'),
      placeholder: t('workflows.tasks.filters.workflowInstanceIdPlaceholder'),
    },
  ]

  const columns: ColumnDef<UserTask>[] = [
    {
      id: 'taskName',
      header: t('workflows.tasks.fields.taskName'),
      accessorKey: 'taskName',
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-sm">{row.original.taskName}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">
              {row.original.description}
            </div>
          )}
          {isOverdue(row.original) && (
            <div className="text-xs text-red-600 font-medium mt-1">
              {t('workflows.tasks.overdue')}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'status',
      header: t('workflows.tasks.fields.status'),
      accessorKey: 'status',
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(row.original.status)}`}>
          {t(`workflows.tasks.status.${row.original.status}`)}
        </span>
      ),
    },
    {
      id: 'assignment',
      header: t('workflows.tasks.fields.assignment'),
      cell: ({ row }) => {
        if (row.original.claimedBy) {
          return (
            <div className="text-sm">
              <div className="text-foreground">{t('workflows.tasks.claimedBy')}: {row.original.claimedBy}</div>
            </div>
          )
        }
        if (row.original.assignedTo) {
          return <div className="text-sm text-foreground">{row.original.assignedTo}</div>
        }
        if (row.original.assignedToRoles && row.original.assignedToRoles.length > 0) {
          return (
            <div className="text-sm text-muted-foreground">
              {t('workflows.tasks.roles')}: {row.original.assignedToRoles.join(', ')}
            </div>
          )
        }
        return <span className="text-sm text-muted-foreground">-</span>
      },
    },
    {
      id: 'dueDate',
      header: t('workflows.tasks.fields.dueDate'),
      accessorKey: 'dueDate',
      cell: ({ row }) => {
        if (!row.original.dueDate) {
          return <span className="text-sm text-muted-foreground">-</span>
        }
        const dueDate = new Date(row.original.dueDate)
        const overdue = isOverdue(row.original)
        return (
          <div className={`text-sm ${overdue ? 'text-red-600 font-medium' : 'text-foreground'}`}>
            {dueDate.toLocaleString()}
          </div>
        )
      },
    },
    {
      id: 'createdAt',
      header: t('workflows.tasks.fields.createdAt'),
      accessorKey: 'createdAt',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const items: Array<{label: string; href?: string; onSelect?: () => void}> = [
          {
            label: t('workflows.tasks.actions.viewDetails'),
            href: `/backend/tasks/${row.original.id}`,
          },
        ]

        // Allow claiming if task is PENDING and assigned to roles (not specific user)
        if (
          row.original.status === 'PENDING' &&
          !row.original.assignedTo &&
          row.original.assignedToRoles &&
          row.original.assignedToRoles.length > 0
        ) {
          items.push({
            label: t('workflows.tasks.actions.claim'),
            onSelect: () => handleClaim(row.original.id, row.original.taskName),
          })
        }

        // Allow completing if task is in progress or pending
        if (row.original.status === 'PENDING' || row.original.status === 'IN_PROGRESS') {
          items.push({
            label: t('workflows.tasks.actions.complete'),
            href: `/backend/tasks/${row.original.id}`,
          })
        }

        return <RowActions items={items} />
      },
    },
  ]

  if (error) {
    return (
      <Page>
        <PageBody>
          <div className="p-8 text-center">
            <p className="text-red-600">{t('workflows.tasks.messages.loadFailed')}</p>
            <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['workflow-tasks'] })} className="mt-4">
              {t('common.retry')}
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('workflows.tasks.list.title')}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{
            tableId: 'workflows.tasks.list',
          }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
