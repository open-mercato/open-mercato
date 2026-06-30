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

type SuiteRow = {
  id: string
  code?: string | null
  name?: string | null
  description?: string | null
  enabled?: boolean | null
}

type SuitesResponse = {
  items?: SuiteRow[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
}

export default function DataQualitySuitesPage() {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  const { data, isLoading, isFetching, error, refetch } = useQuery<SuitesResponse>({
    queryKey: ['data_quality_suites', search, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search.trim()) params.set('search', search.trim())
      const result = await apiCall<SuitesResponse>(`/api/data_quality/suites?${params.toString()}`)
      if (!result.ok) {
        await raiseCrudError(result.response, t('data_quality.errors.suitesLoadFailed', 'Failed to load suites.'))
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

  const columns = React.useMemo<ColumnDef<SuiteRow>[]>(() => [
    {
      id: 'code',
      accessorKey: 'code',
      header: t('data_quality.suites.columns.code', 'Code'),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: t('data_quality.suites.columns.name', 'Name'),
    },
    {
      id: 'enabled',
      accessorKey: 'enabled',
      header: t('data_quality.suites.columns.enabled', 'Enabled'),
      cell: ({ getValue }) => getValue() ? t('common.yes', 'Yes') : t('common.no', 'No'),
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: t('common.description', 'Description'),
      cell: ({ getValue }) => getValue() ?? '—',
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('data_quality.suites.title', 'Data Quality Suites')}
          data={data?.items ?? []}
          columns={columns}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : undefined}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('data_quality.suites.searchPlaceholder', 'Search suites')}
          refreshButton={{
            label: t('common.refresh', 'Refresh'),
            onRefresh: () => { void refetch() },
            isRefreshing: isFetching,
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/data-quality/suites/create">{t('data_quality.suites.create', 'Create Suite')}</Link>
            </Button>
          )}
          rowActions={(row) => [{
            id: 'edit-suite',
            label: t('common.edit', 'Edit'),
            href: `/backend/data-quality/suites/${row.id}`,
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
              <p>{t('data_quality.suites.empty', 'No suites defined yet.')}</p>
              <p>{t('data_quality.suites.emptyDescription', 'Create a suite to group checks together for batch scanning.')}</p>
            </div>
          )}
        />
      </PageBody>
    </Page>
  )
}
