"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type CheckRow = {
  id: string
  code?: string | null
  name?: string | null
  targetEntityType?: string | null
  severity?: string | null
  enabled?: boolean | null
}

type ChecksResponse = {
  items?: CheckRow[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
}

export default function DataQualityChecksPage() {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  const { data, isLoading, isFetching, error, refetch } = useQuery<ChecksResponse>({
    queryKey: ['data_quality_checks', search, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search.trim()) params.set('search', search.trim())
      const result = await apiCall<ChecksResponse>(`/api/data_quality/checks?${params.toString()}`)
      if (!result.ok) {
        await raiseCrudError(result.response, t('data_quality.errors.checksLoadFailed', 'Failed to load checks.'))
      }
      return {
        items: Array.isArray(result.result?.items) ? result.result.items : [],
        total: result.result?.total ?? 0,
        totalPages: result.result?.totalPages ?? 1,
        page: result.result?.page ?? page,
        pageSize: result.result?.pageSize ?? pageSize,
      }
    },
  })

  const columns = React.useMemo<ColumnDef<CheckRow>[]>(() => [
    {
      id: 'code',
      accessorKey: 'code',
      header: t('data_quality.checks.columns.code', 'Code'),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t('data_quality.checks.columns.name', 'Name'),
    },
    {
      id: 'targetEntityType',
      accessorKey: 'targetEntityType',
      header: t('data_quality.checks.columns.target', 'Target'),
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: t('data_quality.checks.columns.severity', 'Severity'),
    },
    {
      id: 'enabled',
      accessorKey: 'enabled',
      header: t('data_quality.checks.columns.enabled', 'Enabled'),
      cell: ({ getValue }) => getValue() ? t('common.yes', 'Yes') : t('common.no', 'No'),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('data_quality.checks.title', 'Data Quality Checks')}
          data={data?.items ?? []}
          columns={columns}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : undefined}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('data_quality.checks.searchPlaceholder', 'Search checks')}
          refreshButton={{
            label: t('common.refresh', 'Refresh'),
            onRefresh: () => { void refetch() },
            isRefreshing: isFetching,
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/data-quality/checks/create">{t('data_quality.checks.create', 'Create Check')}</Link>
            </Button>
          )}
          rowActions={(row) => [{
            id: 'edit-check',
            label: t('common.edit', 'Edit'),
            href: `/backend/data-quality/checks/${row.id}`,
            icon: Pencil,
          }]}
          disableRowClick
          pagination={{
            page: data?.page ?? page,
            totalPages: data?.totalPages ?? 1,
            total: data?.total ?? 0,
            pageSize: data?.pageSize ?? pageSize,
            onPageChange: (nextPage) => setPage(nextPage),
            onPageSizeChange: (nextPageSize) => {
              setPageSize(nextPageSize)
              setPage(1)
            },
          }}
          emptyState={(
            <div className="py-8 text-center text-sm text-muted-foreground">
              <p>{t('data_quality.checks.empty', 'No checks defined yet.')}</p>
              <p>{t('data_quality.checks.emptyDescription', 'Create your first data quality check to start monitoring your data.')}</p>
            </div>
          )}
        />
      </PageBody>
    </Page>
  )
}
