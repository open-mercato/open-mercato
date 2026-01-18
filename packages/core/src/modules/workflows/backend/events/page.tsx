"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'

type WorkflowEvent = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string | null
  eventType: string
  eventData: any
  occurredAt: string
  userId: string | null
  workflowInstance: {
    id: string
    workflowId: string
    workflowName: string
    status: string
  } | null
}

type EventsResponse = {
  items: WorkflowEvent[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export default function WorkflowEventsPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['workflows', 'events', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      params.set('sortField', 'occurredAt')
      params.set('sortDir', 'desc')

      if (filterValues.eventType) params.set('eventType', filterValues.eventType as string)
      if (filterValues.workflowInstanceId) params.set('workflowInstanceId', filterValues.workflowInstanceId as string)
      if (filterValues.userId) params.set('userId', filterValues.userId as string)
      if (filterValues.occurredAtFrom) params.set('occurredAtFrom', filterValues.occurredAtFrom as string)
      if (filterValues.occurredAtTo) params.set('occurredAtTo', filterValues.occurredAtTo as string)

      const result = await apiCall<EventsResponse>(
        `/api/workflows/events?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch workflow events')
      }

      const response = result.result
      if (response) {
        setTotal(response.total || 0)
        setTotalPages(response.totalPages || 1)
      }

      return response?.items || []
    },
  })

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const filters: FilterDef[] = [
    {
      id: 'eventType',
      type: 'select',
      label: t('workflows.events.filters.eventType'),
      options: [
        { value: '', label: t('common.all') },
        { value: 'WORKFLOW_STARTED', label: t('workflows.events.types.workflow_started') },
        { value: 'WORKFLOW_COMPLETED', label: t('workflows.events.types.workflow_completed') },
        { value: 'WORKFLOW_FAILED', label: t('workflows.events.types.workflow_failed') },
        { value: 'WORKFLOW_CANCELLED', label: t('workflows.events.types.workflow_cancelled') },
        { value: 'STEP_ENTERED', label: t('workflows.events.types.step_entered') },
        { value: 'STEP_EXITED', label: t('workflows.events.types.step_exited') },
        { value: 'TRANSITION_EXECUTED', label: t('workflows.events.types.transition_executed') },
        { value: 'TRANSITION_REJECTED', label: t('workflows.events.types.transition_rejected') },
        { value: 'ACTIVITY_STARTED', label: t('workflows.events.types.activity_started') },
        { value: 'ACTIVITY_COMPLETED', label: t('workflows.events.types.activity_completed') },
        { value: 'ACTIVITY_FAILED', label: t('workflows.events.types.activity_failed') },
      ],
    },
    {
      id: 'workflowInstanceId',
      type: 'text',
      label: t('workflows.events.filters.workflowInstanceId'),
      placeholder: t('workflows.events.filters.workflowInstanceIdPlaceholder'),
    },
    {
      id: 'userId',
      type: 'text',
      label: t('workflows.events.filters.userId'),
      placeholder: t('workflows.events.filters.userIdPlaceholder'),
    },
  ]

  const getEventTypeBadgeClass = (eventType: string) => {
    if (eventType.includes('STARTED')) return 'bg-blue-100 text-blue-800'
    if (eventType.includes('COMPLETED')) return 'bg-green-100 text-green-800'
    if (eventType.includes('FAILED') || eventType.includes('REJECTED')) return 'bg-red-100 text-red-800'
    if (eventType.includes('CANCELLED')) return 'bg-gray-100 text-gray-800'
    if (eventType.includes('ENTERED') || eventType.includes('EXITED')) return 'bg-purple-100 text-purple-800'
    return 'bg-gray-100 text-gray-800'
  }

  const columns: ColumnDef<WorkflowEvent>[] = [
    {
      id: 'occurredAt',
      header: t('workflows.events.fields.occurredAt'),
      accessorKey: 'occurredAt',
      cell: ({ row }) => (
        <div className="text-sm">
          {new Date(row.original.occurredAt).toLocaleString()}
        </div>
      ),
    },
    {
      id: 'eventType',
      header: t('workflows.events.fields.eventType'),
      accessorKey: 'eventType',
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getEventTypeBadgeClass(
            row.original.eventType
          )}`}
        >
          {row.original.eventType}
        </span>
      ),
    },
    {
      id: 'workflow',
      header: t('workflows.events.fields.workflow'),
      cell: ({ row }) => (
        <div>
          {row.original.workflowInstance ? (
            <>
              <Link
                href={`/backend/instances/${row.original.workflowInstance.id}`}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
              >
                {row.original.workflowInstance.workflowName}
              </Link>
              <div className="text-xs text-gray-500 mt-0.5">
                {row.original.workflowInstance.workflowId}
              </div>
            </>
          ) : (
            <span className="text-gray-500 text-sm">
              {t('workflows.events.workflowNotFound')}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'instance',
      header: t('workflows.events.fields.instance'),
      cell: ({ row }) => (
        <div className="text-sm">
          <Link
            href={`/backend/instances/${row.original.workflowInstanceId}`}
            className="text-blue-600 hover:text-blue-800 hover:underline font-mono text-xs"
          >
            {row.original.workflowInstanceId.substring(0, 8)}...
          </Link>
        </div>
      ),
    },
    {
      id: 'status',
      header: t('workflows.events.fields.status'),
      cell: ({ row }) => (
        <div>
          {row.original.workflowInstance && (
            <span
              className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                row.original.workflowInstance.status === 'COMPLETED'
                  ? 'bg-green-100 text-green-800'
                  : row.original.workflowInstance.status === 'RUNNING'
                  ? 'bg-blue-100 text-blue-800'
                  : row.original.workflowInstance.status === 'FAILED'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {row.original.workflowInstance.status}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'userId',
      header: t('workflows.events.fields.userId'),
      accessorKey: 'userId',
      cell: ({ row }) => (
        <div className="text-sm text-gray-700 font-mono text-xs">
          {row.original.userId ? row.original.userId.substring(0, 8) + '...' : '-'}
        </div>
      ),
    },
    {
      id: 'eventData',
      header: t('workflows.events.fields.eventData'),
      cell: ({ row }) => (
        <div className="text-xs text-gray-600 max-w-xs truncate">
          {JSON.stringify(row.original.eventData).substring(0, 50)}...
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Link
          href={`/backend/events/${row.original.id}`}
          className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
        >
          {t('common.details')}
        </Link>
      ),
    },
  ]

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('workflows.events.list.title')}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          isLoading={isLoading}
          error={error ? t('workflows.events.messages.loadFailed') : undefined}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              {isLoading ? t('common.refreshing') : t('common.refresh')}
            </Button>
          }
        />
      </PageBody>
    </Page>
  )
}
