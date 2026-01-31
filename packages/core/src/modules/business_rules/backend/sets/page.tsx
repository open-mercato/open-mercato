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

type RuleSet = {
  id: string
  setId: string
  setName: string
  description: string | null
  enabled: boolean
  tenantId: string
  organizationId: string
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

type RuleSetsResponse = {
  items: RuleSet[]
  total: number
  totalPages: number
}

export default function RuleSetsListPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['business-rules', 'sets', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      params.set('sortField', 'setName')
      params.set('sortDir', 'asc')

      if (filterValues.enabled) params.set('enabled', filterValues.enabled as string)
      if (filterValues.search) params.set('search', filterValues.search as string)

      const result = await apiCall<RuleSetsResponse>(
        `/api/business_rules/sets?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch rule sets')
      }

      const response = result.result
      if (response) {
        setTotal(response.total || 0)
        setTotalPages(response.totalPages || 1)
      }

      return response?.items || []
    },
  })

  const handleDelete = async (id: string, setName: string) => {
    if (!confirm(t('business_rules.sets.confirm.delete', { name: setName }))) {
      return
    }

    const result = await apiCall(`/api/business_rules/sets?id=${id}`, {
      method: 'DELETE',
    })

    if (result.ok) {
      flash(t('business_rules.sets.messages.deleted'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets'] })
    } else {
      flash(t('business_rules.sets.messages.deleteFailed'), 'error')
    }
  }

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    const result = await apiCall('/api/business_rules/sets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        enabled: !currentEnabled,
      }),
    })

    if (result.ok) {
      flash(t('business_rules.sets.messages.updated'), 'success')
      queryClient.invalidateQueries({ queryKey: ['business-rules', 'sets'] })
    } else {
      flash(t('business_rules.sets.messages.updateFailed'), 'error')
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
      placeholder: t('business_rules.sets.filters.searchPlaceholder'),
    },
    {
      id: 'enabled',
      type: 'select',
      label: t('business_rules.filters.status'),
      options: [
        { value: '', label: t('common.all') },
        { value: 'true', label: t('common.enabled') },
        { value: 'false', label: t('common.disabled') },
      ],
    },
  ]

  const columns: ColumnDef<RuleSet>[] = [
    {
      id: 'setId',
      header: t('business_rules.sets.fields.setId'),
      accessorKey: 'setId',
      cell: ({ row }) => (
        <Link
          href={`/backend/sets/${row.original.id}`}
          className="font-mono text-sm text-blue-600 hover:text-blue-800 hover:underline"
        >
          {row.original.setId}
        </Link>
      ),
    },
    {
      id: 'setName',
      header: t('business_rules.sets.fields.setName'),
      accessorKey: 'setName',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.setName}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {row.original.description}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'enabled',
      header: t('business_rules.sets.fields.enabled'),
      accessorKey: 'enabled',
      cell: ({ row }) => (
        <button
          onClick={() => handleToggleEnabled(row.original.id, row.original.enabled)}
          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            row.original.enabled
              ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          title={t('business_rules.sets.actions.toggleEnabled')}
        >
          {row.original.enabled ? t('common.yes') : t('common.no')}
        </button>
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
              href: `/backend/sets/${row.original.id}`,
            },
            {
              id: row.original.enabled ? 'disable' : 'enable',
              label: row.original.enabled ? t('common.disable') : t('common.enable'),
              onSelect: () => handleToggleEnabled(row.original.id, row.original.enabled),
            },
            {
              id: 'delete',
              label: t('common.delete'),
              onSelect: () => handleDelete(row.original.id, row.original.setName),
              destructive: true,
            },
          ]}
        />
      ),
    },
  ]

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('business_rules.sets.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/sets/create">
                {t('business_rules.sets.actions.create')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          isLoading={isLoading}
          error={error ? t('business_rules.sets.messages.loadFailed') : undefined}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
