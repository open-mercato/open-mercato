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

type Rule = {
  id: string
  ruleId: string
  ruleName: string
  description: string | null
  ruleType: 'GUARD' | 'VALIDATION' | 'CALCULATION' | 'ACTION' | 'ASSIGNMENT'
  ruleCategory: string | null
  entityType: string
  eventType: string | null
  enabled: boolean
  priority: number
  version: number
  effectiveFrom: string | null
  effectiveTo: string | null
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
}

type RulesResponse = {
  items: Rule[]
  total: number
  totalPages: number
}

export default function RulesListPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['business-rules', 'list', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      params.set('sortField', 'priority')
      params.set('sortDir', 'desc')

      if (filterValues.enabled) params.set('enabled', filterValues.enabled as string)
      if (filterValues.ruleType) params.set('ruleType', filterValues.ruleType as string)
      if (filterValues.entityType) params.set('entityType', filterValues.entityType as string)
      if (filterValues.eventType) params.set('eventType', filterValues.eventType as string)
      if (filterValues.search) params.set('search', filterValues.search as string)

      const result = await apiCall<RulesResponse>(
        `/api/business_rules/rules?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch rules')
      }

      const response = result.result
      if (response) {
        setTotal(response.total || 0)
        setTotalPages(response.totalPages || 1)
      }

      return response?.items || []
    },
  })

  const handleDelete = async (id: string, ruleName: string) => {
    if (!confirm(t('business_rules.confirm.delete', { name: ruleName }))) {
      return
    }

    const result = await apiCall(`/api/business_rules/rules?id=${id}`, {
      method: 'DELETE',
    })

    if (result.ok) {
      flash(t('business_rules.messages.deleted'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules'] })
    } else {
      flash(t('business_rules.messages.deleteFailed'), 'error')
    }
  }

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    const result = await apiCall('/api/business_rules/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        enabled: !currentEnabled,
      }),
    })

    if (result.ok) {
      flash(t('business_rules.messages.updated'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules'] })
    } else {
      flash(t('business_rules.messages.updateFailed'), 'error')
    }
  }

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined) next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [setFilterValues, setPage])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [setFilterValues, setPage])

  const filters: FilterDef[] = [
    {
      id: 'search',
      type: 'text',
      label: t('business_rules.filters.search'),
      placeholder: t('business_rules.filters.searchPlaceholder'),
    },
    {
      id: 'enabled',
      type: 'select',
      label: t('business_rules.filters.status'),
      options: [
        { label: t('common.all'), value: '' },
        { label: t('common.enabled'), value: 'true' },
        { label: t('common.disabled'), value: 'false' },
      ],
    },
    {
      id: 'ruleType',
      type: 'select',
      label: t('business_rules.filters.type'),
      options: [
        { label: t('common.all'), value: '' },
        { label: t('business_rules.types.guard'), value: 'GUARD' },
        { label: t('business_rules.types.validation'), value: 'VALIDATION' },
        { label: t('business_rules.types.calculation'), value: 'CALCULATION' },
        { label: t('business_rules.types.action'), value: 'ACTION' },
        { label: t('business_rules.types.assignment'), value: 'ASSIGNMENT' },
      ],
    },
    {
      id: 'entityType',
      type: 'text',
      label: t('business_rules.filters.entityType'),
      placeholder: t('business_rules.filters.entityTypePlaceholder'),
    },
    {
      id: 'eventType',
      type: 'text',
      label: t('business_rules.filters.eventType'),
      placeholder: t('business_rules.filters.eventTypePlaceholder'),
    },
  ]

  const columns: ColumnDef<Rule>[] = [
    {
      id: 'ruleId',
      header: t('business_rules.fields.ruleId'),
      accessorKey: 'ruleId',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.ruleId}</span>
      ),
    },
    {
      id: 'ruleName',
      header: t('business_rules.fields.ruleName'),
      accessorKey: 'ruleName',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.ruleName}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">
              {row.original.description}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'ruleType',
      header: t('business_rules.fields.ruleType'),
      accessorKey: 'ruleType',
      cell: ({ row }) => {
        const typeColors = {
          GUARD: 'bg-red-100 text-red-800',
          VALIDATION: 'bg-yellow-100 text-yellow-800',
          CALCULATION: 'bg-blue-100 text-blue-800',
          ACTION: 'bg-green-100 text-green-800',
          ASSIGNMENT: 'bg-purple-100 text-purple-800',
        }
        const color = typeColors[row.original.ruleType] || 'bg-muted text-foreground'
        return (
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${color}`}>
            {row.original.ruleType}
          </span>
        )
      },
    },
    {
      id: 'entityType',
      header: t('business_rules.fields.entityType'),
      accessorKey: 'entityType',
    },
    {
      id: 'eventType',
      header: t('business_rules.fields.eventType'),
      accessorKey: 'eventType',
      cell: ({ row }) => row.original.eventType || '-',
    },
    {
      id: 'enabled',
      header: t('business_rules.fields.enabled'),
      accessorKey: 'enabled',
      cell: ({ row }) => (
        <button
          onClick={() => handleToggleEnabled(row.original.id, row.original.enabled)}
          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            row.original.enabled
              ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          title={t('business_rules.actions.toggleEnabled')}
        >
          {row.original.enabled ? t('common.yes') : t('common.no')}
        </button>
      ),
    },
    {
      id: 'priority',
      header: t('business_rules.fields.priority'),
      accessorKey: 'priority',
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.priority}</span>
      ),
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
              href: `/backend/rules/${row.original.id}`,
            },
            {
              id: row.original.enabled ? 'disable' : 'enable',
              label: row.original.enabled ? t('common.disable') : t('common.enable'),
              onSelect: () => handleToggleEnabled(row.original.id, row.original.enabled),
            },
            {
              id: 'duplicate',
              label: t('common.duplicate'),
              onSelect: () => {
                // TODO: Implement duplicate functionality in Step 5.2
                flash(t('business_rules.messages.duplicateNotYetImplemented'), 'info')
              },
            },
            {
              id: 'delete',
              label: t('common.delete'),
              onSelect: () => handleDelete(row.original.id, row.original.ruleName),
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
          <div className="p-8 text-center">
            <p className="text-red-600">{t('business_rules.messages.loadFailed')}</p>
            <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['business-rules'] })} className="mt-4">
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
          title={t('business_rules.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/rules/create">
                {t('business_rules.actions.create')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          perspective={{
            tableId: 'business-rules.rules.list',
          }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
