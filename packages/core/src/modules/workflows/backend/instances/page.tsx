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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type WorkflowInstance = {
  id: string
  definitionId: string
  workflowId: string
  version: number
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'COMPENSATING' | 'COMPENSATED'
  currentStepId: string
  correlationKey: string | null
  startedAt: string
  completedAt: string | null
  cancelledAt: string | null
  errorMessage: string | null
  retryCount: number
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

type InstancesResponse = {
  data: WorkflowInstance[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export default function WorkflowInstancesListPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-instances', 'list', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      const offset = (page - 1) * pageSize
      params.set('limit', pageSize.toString())
      params.set('offset', offset.toString())

      if (filterValues.status) params.set('status', filterValues.status as string)
      if (filterValues.workflowId) params.set('workflowId', filterValues.workflowId as string)
      if (filterValues.correlationKey) params.set('correlationKey', filterValues.correlationKey as string)
      if (filterValues.entityType) params.set('entityType', filterValues.entityType as string)
      if (filterValues.entityId) params.set('entityId', filterValues.entityId as string)

      const result = await apiCall<InstancesResponse>(
        `/api/workflows/instances?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch workflow instances')
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

  const handleCancel = async (id: string, workflowId: string) => {
    if (!confirm(t('workflows.instances.confirm.cancel', { id: workflowId }))) {
      return
    }

    const result = await apiCall(`/api/workflows/instances/${id}/cancel`, {
      method: 'POST',
    })

    if (result.ok) {
      flash(t('workflows.instances.messages.cancelled'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-instances'] })
    } else {
      flash(t('workflows.instances.messages.cancelFailed'), 'error')
    }
  }

  const handleRetry = async (id: string, workflowId: string) => {
    if (!confirm(t('workflows.instances.confirm.retry', { id: workflowId }))) {
      return
    }

    const result = await apiCall(`/api/workflows/instances/${id}/retry`, {
      method: 'POST',
    })

    if (result.ok) {
      flash(t('workflows.instances.messages.retried'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-instances'] })
    } else {
      flash(t('workflows.instances.messages.retryFailed'), 'error')
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
    setFilterValues({})
    setPage(1)
  }, [])

  const getStatusBadgeClass = (status: WorkflowInstance['status']) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-blue-100 text-blue-800'
      case 'PAUSED':
        return 'bg-yellow-100 text-yellow-800'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'FAILED':
        return 'bg-red-100 text-red-800'
      case 'CANCELLED':
        return 'bg-muted text-foreground'
      case 'COMPENSATING':
        return 'bg-orange-100 text-orange-800'
      case 'COMPENSATED':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const filters: FilterDef[] = [
    {
      id: 'status',
      type: 'select',
      label: t('workflows.instances.filters.status'),
      options: [
        { label: t('common.all'), value: '' },
        { label: t('workflows.instances.status.RUNNING'), value: 'RUNNING' },
        { label: t('workflows.instances.status.PAUSED'), value: 'PAUSED' },
        { label: t('workflows.instances.status.COMPLETED'), value: 'COMPLETED' },
        { label: t('workflows.instances.status.FAILED'), value: 'FAILED' },
        { label: t('workflows.instances.status.CANCELLED'), value: 'CANCELLED' },
        { label: t('workflows.instances.status.COMPENSATING'), value: 'COMPENSATING' },
        { label: t('workflows.instances.status.COMPENSATED'), value: 'COMPENSATED' },
      ],
    },
    {
      id: 'workflowId',
      type: 'text',
      label: t('workflows.instances.filters.workflowId'),
      placeholder: t('workflows.instances.filters.workflowIdPlaceholder'),
    },
    {
      id: 'correlationKey',
      type: 'text',
      label: t('workflows.instances.filters.correlationKey'),
      placeholder: t('workflows.instances.filters.correlationKeyPlaceholder'),
    },
    {
      id: 'entityType',
      type: 'text',
      label: t('workflows.instances.filters.entityType'),
      placeholder: t('workflows.instances.filters.entityTypePlaceholder'),
    },
    {
      id: 'entityId',
      type: 'text',
      label: t('workflows.instances.filters.entityId'),
      placeholder: t('workflows.instances.filters.entityIdPlaceholder'),
    },
  ]

  const columns: ColumnDef<WorkflowInstance>[] = [
    {
      id: 'workflowId',
      header: t('workflows.instances.fields.workflowId'),
      accessorKey: 'workflowId',
      cell: ({ row }) => (
        <div>
          <div className="font-mono text-sm font-medium">{row.original.workflowId}</div>
          {row.original.correlationKey && (
            <div className="text-xs text-muted-foreground">
              {t('workflows.instances.fields.correlationKey')}: {row.original.correlationKey}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'status',
      header: t('workflows.instances.fields.status'),
      accessorKey: 'status',
      cell: ({ row }) => (
        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(row.original.status)}`}>
          {t(`workflows.instances.status.${row.original.status}`)}
        </span>
      ),
    },
    {
      id: 'currentStep',
      header: t('workflows.instances.fields.currentStep'),
      accessorKey: 'currentStepId',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.currentStepId}</span>
      ),
    },
    {
      id: 'timing',
      header: t('workflows.instances.fields.timing'),
      cell: ({ row }) => {
        const started = new Date(row.original.startedAt)
        const completed = row.original.completedAt ? new Date(row.original.completedAt) : null
        const duration = completed ? completed.getTime() - started.getTime() : Date.now() - started.getTime()
        const durationText = duration < 60000
          ? `${Math.floor(duration / 1000)}s`
          : `${Math.floor(duration / 60000)}m`

        return (
          <div className="text-sm">
            <div className="text-foreground">{started.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">
              {completed ? t('workflows.instances.duration') : t('workflows.instances.elapsed')}: {durationText}
            </div>
          </div>
        )
      },
    },
    {
      id: 'retryCount',
      header: t('workflows.instances.fields.retryCount'),
      accessorKey: 'retryCount',
      cell: ({ row }) => (
        <span className={`text-sm ${row.original.retryCount > 0 ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}>
          {row.original.retryCount}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const items: Array<{label: string; href?: string; onSelect?: () => void}> = [
          {
            label: t('workflows.instances.actions.viewDetails'),
            href: `/backend/instances/${row.original.id}`,
          },
        ]

        if (row.original.status === 'RUNNING' || row.original.status === 'PAUSED') {
          items.push({
            label: t('workflows.instances.actions.cancel'),
            onSelect: () => handleCancel(row.original.id, row.original.workflowId),
          })
        }

        if (row.original.status === 'FAILED') {
          items.push({
            label: t('workflows.instances.actions.retry'),
            onSelect: () => handleRetry(row.original.id, row.original.workflowId),
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
            <p className="text-red-600">{t('workflows.instances.messages.loadFailed')}</p>
            <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['workflow-instances'] })} className="mt-4">
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
          title={t('workflows.instances.list.title')}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{
            tableId: 'workflows.instances.list',
          }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
