"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import {Trash2} from "lucide-react";

type WorkflowDefinition = {
  id: string
  workflowId: string
  workflowName: string
  description: string | null
  version: number
  enabled: boolean
  effectiveFrom: string | null
  effectiveTo: string | null
  metadata: {
    tags?: string[]
    category?: string
    icon?: string
  } | null
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

type DefinitionsResponse = {
  data: WorkflowDefinition[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export default function WorkflowDefinitionsListPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-definitions', 'list', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      const offset = (page - 1) * pageSize
      params.set('limit', pageSize.toString())
      params.set('offset', offset.toString())

      if (filterValues.enabled !== undefined && filterValues.enabled !== '') {
        params.set('enabled', filterValues.enabled as string)
      }
      if (filterValues.workflowId) params.set('workflowId', filterValues.workflowId as string)
      if (filterValues.search) params.set('search', filterValues.search as string)

      const result = await apiCall<DefinitionsResponse>(
        `/api/workflows/definitions?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch workflow definitions')
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

  const handleDelete = (id: string, workflowName: string) => {
    setDeleteTarget({ id, name: workflowName })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return

    const result = await apiCall(`/api/workflows/definitions/${deleteTarget.id}`, {
      method: 'DELETE',
    })

    if (result.ok) {
      flash(t('workflows.messages.deleted'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
    } else {
      flash(t('workflows.messages.deleteFailed'), 'error')
    }
    setDeleteTarget(null)
  }

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    const result = await apiCall(`/api/workflows/definitions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: !currentEnabled,
      }),
    })

    if (result.ok) {
      flash(t('workflows.messages.updated'), 'success')
      queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
    } else {
      flash(t('workflows.messages.updateFailed'), 'error')
    }
  }

  const handleDuplicate = async (definition: WorkflowDefinition) => {
    // TODO: Implement duplicate functionality
    flash(t('workflows.messages.duplicateNotYetImplemented'), 'info')
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

  const filters: FilterDef[] = [
    {
      id: 'search',
      type: 'text',
      label: t('workflows.filters.search'),
      placeholder: t('workflows.filters.searchPlaceholder'),
    },
    {
      id: 'enabled',
      type: 'select',
      label: t('workflows.filters.status'),
      options: [
        { label: t('common.all'), value: '' },
        { label: t('common.enabled'), value: 'true' },
        { label: t('common.disabled'), value: 'false' },
      ],
    },
    {
      id: 'workflowId',
      type: 'text',
      label: t('workflows.filters.workflowId'),
      placeholder: t('workflows.filters.workflowIdPlaceholder'),
    },
  ]

  const columns: ColumnDef<WorkflowDefinition>[] = [
    {
      id: 'workflowId',
      header: t('workflows.fields.workflowId'),
      accessorKey: 'workflowId',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.workflowId}</span>
      ),
    },
    {
      id: 'workflowName',
      header: t('workflows.fields.workflowName'),
      accessorKey: 'workflowName',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.workflowName}</div>
          {row.original.description && (
            <div className="text-xs text-gray-500 line-clamp-1">
              {row.original.description}
            </div>
          )}
          {row.original.metadata?.category && (
            <div className="text-xs text-gray-400 mt-0.5">
              {row.original.metadata.category}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'version',
      header: t('workflows.fields.version'),
      accessorKey: 'version',
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono">
          v{row.original.version}
        </Badge>
      ),
    },
    {
      id: 'enabled',
      header: t('workflows.fields.enabled'),
      accessorKey: 'enabled',
      cell: ({ row }) => (
        <button
          onClick={() => handleToggleEnabled(row.original.id, row.original.enabled)}
          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            row.original.enabled
              ? 'bg-green-100 text-green-800 hover:bg-green-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={t('workflows.actions.toggleEnabled')}
        >
          {row.original.enabled ? t('common.yes') : t('common.no')}
        </button>
      ),
    },
    {
      id: 'tags',
      header: t('workflows.fields.tags'),
      cell: ({ row }) => {
        const tags = row.original.metadata?.tags || []
        if (tags.length === 0) return <span className="text-gray-400">-</span>
        return (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag, idx) => (
              <Badge key={idx} variant="secondary">
                {tag}
              </Badge>
            ))}
            {tags.length > 2 && (
              <Badge variant="outline">+{tags.length - 2}</Badge>
            )}
          </div>
        )
      },
    },
    {
      id: 'createdAt',
      header: t('workflows.fields.createdAt'),
      accessorKey: 'createdAt',
      cell: ({ row }) => {
        const date = new Date(row.original.createdAt)
        return <span className="text-sm text-gray-600">{date.toLocaleDateString()}</span>
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <RowActions
          items={[
            {
              id: 'edit',
              label: t('common.edit'),
              href: `/backend/definitions/${row.original.id}`,
            },
            {
              id: 'edit-visual',
              label: t('workflows.actions.editVisually'),
              href: `/backend/definitions/visual-editor?id=${row.original.id}`,
            },
            {
              id: row.original.enabled ? 'disable' : 'enable',
              label: row.original.enabled ? t('common.disable') : t('common.enable'),
              onSelect: () => handleToggleEnabled(row.original.id, row.original.enabled),
            },
            {
              id: 'duplicate',
              label: t('common.duplicate'),
              onSelect: () => handleDuplicate(row.original),
            },
            {
              id: 'delete',
              label: t('common.delete'),
              onSelect: () => handleDelete(row.original.id, row.original.workflowName),
              destructive: true,
            },
          ]}
        />
      ),
    },
  ]

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('workflows.messages.loadFailed')}
            description={error.message}
            action={(
              <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('workflows.list.title')}
          actions={(
            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link href="/backend/definitions/visual-editor">
                  {t('workflows.actions.createVisual')}
                </Link>
              </Button>
              <Button asChild>
                <Link href="/backend/definitions/create">
                  {t('workflows.actions.create')}
                </Link>
              </Button>
            </div>
          )}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          onRowClick={(row) => router.push(`/backend/definitions/visual-editor?id=${row.id}`)}
          perspective={{
            tableId: 'workflows.definitions.list',
          }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
        <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('workflows.confirm.deleteTitle')}</DialogTitle>
              <DialogDescription>
                {t('workflows.confirm.delete', { name: deleteTarget?.name ?? '' })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                <Trash2/>
                {t('common.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
