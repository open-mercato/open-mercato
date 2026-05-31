"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ScanRow = {
  id: string
  suiteName?: string | null
  targetEntityType?: string | null
  status: string
  progress?: number | null
  score?: number | null
  openFindingCount?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  requestedByName?: string | null
}

type ScansResponse = {
  items?: ScanRow[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString()
}

export default function DataQualityScansPage() {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)

  const { data, isLoading, isFetching, error, refetch } = useQuery<ScansResponse>({
    queryKey: ['data_quality_scans', search, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search.trim()) params.set('search', search.trim())
      const result = await apiCall<ScansResponse>(`/api/data_quality/scans?${params.toString()}`)
      if (!result.ok) {
        await raiseCrudError(result.response, t('data_quality.errors.scansLoadFailed', 'Failed to load scan runs.'))
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

  const columns = React.useMemo<ColumnDef<ScanRow>[]>(() => [
    {
      id: 'suiteName',
      accessorKey: 'suiteName',
      header: t('data_quality.scans.columns.suite', 'Suite'),
      cell: ({ row }) => row.original.suiteName ?? row.original.targetEntityType ?? '—',
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('data_quality.scans.columns.status', 'Status'),
    },
    {
      id: 'progress',
      accessorKey: 'progress',
      header: t('data_quality.scans.columns.progress', 'Progress'),
      cell: ({ getValue }) => getValue() == null ? '—' : `${Number(getValue())}%`,
    },
    {
      id: 'score',
      accessorKey: 'score',
      header: t('data_quality.scans.columns.score', 'Score'),
      cell: ({ getValue }) => getValue() == null ? '—' : `${Number(getValue())}%`,
    },
    {
      id: 'openFindingCount',
      accessorKey: 'openFindingCount',
      header: t('data_quality.scans.columns.findings', 'Findings'),
      cell: ({ getValue }) => Number(getValue() ?? 0),
    },
    {
      id: 'startedAt',
      accessorKey: 'startedAt',
      header: t('data_quality.scans.columns.startedAt', 'Started'),
      cell: ({ row }) => formatDateTime(row.original.startedAt),
    },
    {
      id: 'finishedAt',
      accessorKey: 'finishedAt',
      header: t('data_quality.scans.columns.finishedAt', 'Finished'),
      cell: ({ row }) => formatDateTime(row.original.finishedAt),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('data_quality.scans.title', 'Scan Runs')}
          data={data?.items ?? []}
          columns={columns}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : undefined}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('data_quality.scans.searchPlaceholder', 'Search scans')}
          refreshButton={{
            label: t('common.refresh', 'Refresh'),
            onRefresh: () => { void refetch() },
            isRefreshing: isFetching,
          }}
          actions={(
            <Button variant="outline" asChild>
              <Link href="/backend/data-quality">{t('data_quality.scans.start', 'Start Scan')}</Link>
            </Button>
          )}
          rowActions={(row) => [{
            id: 'view-scan',
            label: t('common.view', 'View'),
            href: `/backend/data-quality/scans/${row.id}`,
            icon: Eye,
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
              <p>{t('data_quality.scans.empty', 'No scans have been run yet.')}</p>
              <p>{t('data_quality.scans.emptyDescription', 'Start a scan from a suite or the overview page.')}</p>
            </div>
          )}
        />
      </PageBody>
    </Page>
  )
}
