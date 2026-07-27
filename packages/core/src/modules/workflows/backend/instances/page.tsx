"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, ExpandedState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

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
  metadata?: { labels?: Record<string, string> | null } | null
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

// Row shape rendered by the accordion. `children` are lazily-loaded
// sub-workflow instances; placeholder rows carry a `__placeholder` marker so
// the loading/empty state renders inline under an expanded parent.
type InstanceRow = WorkflowInstance & {
  children?: InstanceRow[]
  __placeholder?: 'loading' | 'empty'
  __parentId?: string
}

function makePlaceholderRow(parentId: string, kind: 'loading' | 'empty'): InstanceRow {
  return {
    id: `${parentId}::${kind}`,
    __placeholder: kind,
    __parentId: parentId,
  } as InstanceRow
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
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  // Grouped (default): list top-level instances and nest sub-workflow children
  // under their parent. Flat: legacy unfiltered view of every instance.
  const [grouped, setGrouped] = React.useState(true)
  const [expanded, setExpanded] = React.useState<ExpandedState>({})
  const [childrenByParent, setChildrenByParent] = React.useState<Map<string, InstanceRow[]>>(new Map())

  const buildListParams = React.useCallback(() => {
    const params = new URLSearchParams()
    if (filterValues.status) params.set('status', filterValues.status as string)
    if (filterValues.workflowId) params.set('workflowId', filterValues.workflowId as string)
    if (filterValues.correlationKey) params.set('correlationKey', filterValues.correlationKey as string)
    if (filterValues.entityType) params.set('entityType', filterValues.entityType as string)
    if (filterValues.entityId) params.set('entityId', filterValues.entityId as string)
    return params
  }, [filterValues])

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-instances', 'list', filterValues, page, grouped],
    queryFn: async () => {
      const params = buildListParams()
      const offset = (page - 1) * pageSize
      params.set('limit', pageSize.toString())
      params.set('offset', offset.toString())
      // In grouped mode only top-level instances paginate; children are loaded
      // lazily per parent on expand.
      if (grouped) params.set('hasParent', 'false')

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

  // Reset accordion state whenever the top-level result set changes (filters,
  // page, mode) so stale expansions/children don't leak across views.
  React.useEffect(() => {
    setExpanded({})
    setChildrenByParent(new Map())
  }, [filterValues, page, grouped])

  const loadChildren = React.useCallback(async (parentId: string) => {
    setChildrenByParent((prev) => {
      const next = new Map(prev)
      next.set(parentId, [makePlaceholderRow(parentId, 'loading')])
      return next
    })
    // Children are fetched by parent id only — the top-level content filters
    // (status, workflowId, correlationKey, entity*) scope which parents appear,
    // not which sub-workflows a parent reveals when expanded. Carrying them here
    // would surprise users by hiding a parent's non-matching children.
    const params = new URLSearchParams({ parentInstanceId: parentId, limit: '100' })
    const result = await apiCall<InstancesResponse>(`/api/workflows/instances?${params.toString()}`)
    const children = (result.ok ? result.result?.data ?? [] : []) as InstanceRow[]
    setChildrenByParent((prev) => {
      const next = new Map(prev)
      next.set(parentId, children.length ? children : [makePlaceholderRow(parentId, 'empty')])
      return next
    })
  }, [])

  const handleExpandedChange = React.useCallback((updater: ExpandedState | ((old: ExpandedState) => ExpandedState)) => {
    setExpanded((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      const prevRec = (prev === true ? {} : prev) as Record<string, boolean>
      const nextRec = (next === true ? {} : next) as Record<string, boolean>
      for (const rowId of Object.keys(nextRec)) {
        if (nextRec[rowId] && !prevRec[rowId] && !childrenByParent.has(rowId)) {
          void loadChildren(rowId)
        }
      }
      return next
    })
  }, [childrenByParent, loadChildren])

  // Build the nested row tree from the top-level result + lazily-loaded
  // children. A visited set guards against pathological cycles so expansion
  // can never recurse infinitely.
  const treeData = React.useMemo<InstanceRow[]>(() => {
    const buildRow = (instance: WorkflowInstance, ancestors: Set<string>): InstanceRow => {
      const loaded = childrenByParent.get(instance.id)
      if (!loaded) return { ...instance }
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(instance.id)
      const children = loaded.map((child) =>
        child.__placeholder || nextAncestors.has(child.id)
          ? child
          : buildRow(child, nextAncestors)
      )
      return { ...instance, children }
    }
    return (data || []).map((instance) => buildRow(instance, new Set()))
  }, [data, childrenByParent])

  const handleCancel = async (id: string, workflowId: string) => {
    const confirmed = await confirmDialog({
      title: t('workflows.instances.confirm.cancel', { id: workflowId }),
      variant: 'destructive',
    })
    if (!confirmed) {
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
    const ok = await confirmDialog({
      title: t('workflows.instances.confirm.retry', { id: workflowId }),
      variant: 'default',
    })
    if (!ok) {
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
        return 'bg-status-info-bg text-status-info-text'
      case 'PAUSED':
        return 'bg-status-warning-bg text-status-warning-text'
      case 'COMPLETED':
        return 'bg-status-success-bg text-status-success-text'
      case 'FAILED':
        return 'bg-status-error-bg text-status-error-text'
      case 'CANCELLED':
        return 'bg-status-neutral-bg text-status-neutral-text'
      case 'COMPENSATING':
        return 'bg-status-warning-bg text-status-warning-text'
      case 'COMPENSATED':
        return 'bg-status-neutral-bg text-status-neutral-text'
      default:
        return 'bg-status-neutral-bg text-status-neutral-text'
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

  const columns: ColumnDef<InstanceRow>[] = [
    {
      id: 'workflowId',
      header: t('workflows.instances.fields.workflowId'),
      accessorKey: 'workflowId',
      cell: ({ row }) => {
        if (row.original.__placeholder === 'loading') {
          return (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" />
              {t('workflows.instances.subWorkflows.loading', 'Loading sub-workflows…')}
            </span>
          )
        }
        if (row.original.__placeholder === 'empty') {
          return (
            <span className="text-sm text-muted-foreground">
              {t('workflows.instances.subWorkflows.empty', 'No sub-workflows')}
            </span>
          )
        }
        return (
          <Link href={`/backend/instances/${row.original.id}`} className="block hover:underline">
            <div className="font-mono text-sm font-medium">{row.original.workflowId}</div>
            {row.original.correlationKey && (
              <div className="text-xs text-muted-foreground">
                {t('workflows.instances.fields.correlationKey')}: {row.original.correlationKey}
              </div>
            )}
          </Link>
        )
      },
    },
    {
      id: 'status',
      header: t('workflows.instances.fields.status'),
      accessorKey: 'status',
      cell: ({ row }) => {
        if (row.original.__placeholder) return null
        return (
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getStatusBadgeClass(row.original.status)}`}>
            {t(`workflows.instances.status.${row.original.status}`)}
          </span>
        )
      },
    },
    {
      id: 'currentStep',
      header: t('workflows.instances.fields.currentStep'),
      accessorKey: 'currentStepId',
      cell: ({ row }) => {
        if (row.original.__placeholder) return null
        return <span className="text-sm text-muted-foreground">{row.original.currentStepId}</span>
      },
    },
    {
      id: 'timing',
      header: t('workflows.instances.fields.timing'),
      cell: ({ row }) => {
        if (row.original.__placeholder) return null
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
      cell: ({ row }) => {
        if (row.original.__placeholder) return null
        return (
          <span className={`text-sm ${row.original.retryCount > 0 ? 'text-orange-600 font-medium' : 'text-muted-foreground'}`}>
            {row.original.retryCount}
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        if (row.original.__placeholder) return null
        const items: Array<{ id: string; label: string; href?: string; onSelect?: () => void }> = [
          {
            id: 'view',
            label: t('workflows.instances.actions.viewDetails'),
            href: `/backend/instances/${row.original.id}`,
          },
        ]

        if (row.original.status === 'RUNNING' || row.original.status === 'PAUSED') {
          items.push({
            id: 'cancel',
            label: t('workflows.instances.actions.cancel'),
            onSelect: () => void handleCancel(row.original.id, row.original.workflowId),
          })
        }

        if (row.original.status === 'FAILED') {
          items.push({
            id: 'retry',
            label: t('workflows.instances.actions.retry'),
            onSelect: () => void handleRetry(row.original.id, row.original.workflowId),
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
            <p className="text-status-error-text">{t('workflows.instances.messages.loadFailed')}</p>
            <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['workflow-instances'] })} className="mt-4">
              {t('common.retry')}
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  const viewToggle = (
    <SegmentedControl
      value={grouped ? 'grouped' : 'flat'}
      onValueChange={(value) => setGrouped(value === 'grouped')}
      aria-label={t('workflows.instances.list.viewToggle', 'Instance view')}
    >
      <SegmentedControlItem value="grouped">
        {t('workflows.instances.list.topLevelOnly', 'Top-level')}
      </SegmentedControlItem>
      <SegmentedControlItem value="flat">
        {t('workflows.instances.list.showAllFlat', 'All (flat)')}
      </SegmentedControlItem>
    </SegmentedControl>
  )

  return (
    <Page>
      <PageBody>
        <DataTable<InstanceRow>
          title={t('workflows.instances.list.title')}
          actions={viewToggle}
          columns={columns}
          data={grouped ? treeData : ((data || []) as InstanceRow[])}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{
            tableId: 'workflows.instances.list',
          }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          {...(grouped ? {
            getSubRows: (row: InstanceRow) => row.children,
            expandable: (row: InstanceRow) => !row.__placeholder,
            expanded,
            onExpandedChange: handleExpandedChange,
          } : {})}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
