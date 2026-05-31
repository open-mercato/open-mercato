"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SuiteCheck = {
  id: string
  checkId: string
  code?: string | null
  name?: string | null
  severity?: string | null
  enabled?: boolean | null
}

type SuiteChecksResponse = {
  items?: SuiteCheck[]
}

export function SuiteMembershipTable({ suiteId }: { suiteId: string }) {
  const t = useT()
  const { data, isLoading, isFetching, error, refetch } = useQuery<SuiteCheck[]>({
    queryKey: ['data_quality_suite_checks', suiteId],
    queryFn: async () => {
      const result = await apiCall<SuiteChecksResponse>(`/api/data_quality/suites/${encodeURIComponent(suiteId)}/checks`)
      if (!result.ok) {
        await raiseCrudError(result.response, t('data_quality.errors.suiteChecksLoadFailed', 'Failed to load suite checks.'))
      }
      return Array.isArray(result.result?.items) ? result.result.items : []
    },
    enabled: Boolean(suiteId),
  })

  const columns = React.useMemo<ColumnDef<SuiteCheck>[]>(() => [
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
    <DataTable
      title={t('data_quality.suites.checks.title', 'Assigned Checks')}
      data={data ?? []}
      columns={columns}
      isLoading={isLoading}
      error={error instanceof Error ? error.message : undefined}
      refreshButton={{
        label: t('common.refresh', 'Refresh'),
        onRefresh: () => { void refetch() },
        isRefreshing: isFetching,
      }}
      rowActions={(row) => [{
        id: 'edit-check',
        label: t('common.edit', 'Edit'),
        href: `/backend/data-quality/checks/${row.checkId}`,
        icon: Pencil,
      }]}
      emptyState={(
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t('data_quality.suites.checks.empty', 'No checks assigned to this suite.')}
        </div>
      )}
      actions={(
        <Link href="/backend/data-quality/checks" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('data_quality.suites.checks.assign', 'Assign Checks')}
        </Link>
      )}
      disableRowClick
    />
  )
}
