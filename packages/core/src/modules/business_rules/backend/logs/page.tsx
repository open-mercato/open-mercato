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

type RuleExecutionLog = {
  id: string
  ruleId: string
  rule?: {
    id: string
    ruleId: string
    ruleName: string
    ruleType: string
  } | null
  entityType: string
  entityId: string | null
  eventType: string | null
  executedAt: string
  executionTimeMs: number
  executionResult: 'SUCCESS' | 'FAILURE' | 'ERROR'
  resultValue: any | null
  errorMessage: string | null
  inputContext: any | null
  outputContext: any | null
  executedBy: string | null
  tenantId: string | null
  organizationId: string | null
}

type LogsResponse = {
  items: RuleExecutionLog[]
  total: number
  totalPages: number
}

export default function ExecutionLogsPage() {
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(50)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const t = useT()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['business-rules', 'logs', filterValues, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      params.set('sortField', 'executedAt')
      params.set('sortDir', 'desc')

      if (filterValues.ruleId) params.set('ruleId', filterValues.ruleId as string)
      if (filterValues.entityType) params.set('entityType', filterValues.entityType as string)
      if (filterValues.executionResult) params.set('executionResult', filterValues.executionResult as string)
      if (filterValues.executedBy) params.set('executedBy', filterValues.executedBy as string)
      if (filterValues.executedAtFrom) params.set('executedAtFrom', filterValues.executedAtFrom as string)
      if (filterValues.executedAtTo) params.set('executedAtTo', filterValues.executedAtTo as string)

      const result = await apiCall<LogsResponse>(
        `/api/business_rules/logs?${params.toString()}`
      )

      if (!result.ok) {
        throw new Error('Failed to fetch execution logs')
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
      id: 'entityType',
      type: 'text',
      label: t('business_rules.logs.filters.entityType'),
      placeholder: t('business_rules.logs.filters.entityTypePlaceholder'),
    },
    {
      id: 'executionResult',
      type: 'select',
      label: t('business_rules.logs.filters.result'),
      options: [
        { value: '', label: t('common.all') },
        { value: 'SUCCESS', label: t('business_rules.logs.result.success') },
        { value: 'FAILURE', label: t('business_rules.logs.result.failure') },
        { value: 'ERROR', label: t('business_rules.logs.result.error') },
      ],
    },
    {
      id: 'executedBy',
      type: 'text',
      label: t('business_rules.logs.filters.executedBy'),
      placeholder: t('business_rules.logs.filters.executedByPlaceholder'),
    },
    {
      id: 'executedAtFrom',
      type: 'dateRange',
      label: t('business_rules.logs.filters.dateFrom'),
    },
    {
      id: 'executedAtTo',
      type: 'dateRange',
      label: t('business_rules.logs.filters.dateTo'),
    },
  ]

  const getResultBadgeClass = (result: string) => {
    switch (result) {
      case 'SUCCESS':
        return 'bg-green-100 text-green-800'
      case 'FAILURE':
        return 'bg-yellow-100 text-yellow-800'
      case 'ERROR':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-muted text-foreground'
    }
  }

  const columns: ColumnDef<RuleExecutionLog>[] = [
    {
      id: 'executedAt',
      header: t('business_rules.logs.fields.executedAt'),
      accessorKey: 'executedAt',
      cell: ({ row }) => (
        <div className="text-sm">
          {new Date(row.original.executedAt).toLocaleString()}
        </div>
      ),
    },
    {
      id: 'rule',
      header: t('business_rules.logs.fields.rule'),
      cell: ({ row }) => (
        <div>
          {row.original.rule ? (
            <Link
              href={`/backend/rules/${row.original.rule.id}`}
              className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
            >
              {row.original.rule.ruleName}
            </Link>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t('business_rules.logs.ruleDeleted')}
            </span>
          )}
          {row.original.rule && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {row.original.rule.ruleType}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'entity',
      header: t('business_rules.logs.fields.entity'),
      cell: ({ row }) => (
        <div className="text-sm">
          <div className="font-medium">{row.original.entityType}</div>
          {row.original.entityId && (
            <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={row.original.entityId}>
              {row.original.entityId}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'result',
      header: t('business_rules.logs.fields.result'),
      accessorKey: 'executionResult',
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${getResultBadgeClass(
            row.original.executionResult
          )}`}
        >
          {t(`business_rules.logs.result.${row.original.executionResult.toLowerCase()}`)}
        </span>
      ),
    },
    {
      id: 'executionTime',
      header: t('business_rules.logs.fields.executionTime'),
      accessorKey: 'executionTimeMs',
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.executionTimeMs}ms
        </div>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Link
          href={`/backend/logs/${row.original.id}`}
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
          title={t('business_rules.logs.list.title')}
          columns={columns}
          data={data || []}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          isLoading={isLoading}
          error={error ? t('business_rules.logs.messages.loadFailed') : undefined}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}
