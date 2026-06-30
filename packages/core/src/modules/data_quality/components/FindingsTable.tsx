"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle } from 'lucide-react'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Finding = {
  id: string
  checkName?: string | null
  targetEntityType?: string | null
  targetRecordId?: string | null
  recordLink?: string | null
  status: string
  severity: string
  message: string
  firstSeenAt?: string | null
  lastSeenAt?: string | null
}

type FindingsResponse = {
  items?: Finding[]
  total?: number
  totalPages?: number
  page?: number
  pageSize?: number
}

type FindingsTableProps = {
  scanRunId?: string
  title?: string
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString()
}

export function FindingsTable({ scanRunId, title }: FindingsTableProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'data_quality.findings.manage',
  })
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(25)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  const queryKey = React.useMemo(
    () => ['data_quality_findings', scanRunId ?? 'all', search, page, pageSize],
    [page, pageSize, scanRunId, search],
  )

  const { data, isLoading, isFetching, error, refetch } = useQuery<FindingsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search.trim()) params.set('search', search.trim())
      if (scanRunId) params.set('scanRunId', scanRunId)

      const result = await apiCall<FindingsResponse>(`/api/data_quality/findings?${params.toString()}`)
      if (!result.ok) {
        await raiseCrudError(result.response, t('data_quality.errors.findingsLoadFailed', 'Failed to load findings.'))
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

  const columns = React.useMemo<ColumnDef<Finding>[]>(() => [
    {
      id: 'checkName',
      accessorKey: 'checkName',
      header: t('data_quality.findings.columns.check', 'Check'),
      cell: ({ row }) => row.original.checkName ?? row.original.targetEntityType ?? '—',
    },
    {
      id: 'targetRecordId',
      accessorKey: 'targetRecordId',
      header: t('data_quality.findings.columns.record', 'Record'),
      cell: ({ row }) => {
        const label = row.original.targetRecordId ? row.original.targetRecordId.slice(0, 8) : '—'
        if (!row.original.recordLink) return label
        return (
          <Link href={row.original.recordLink} className="text-primary underline-offset-4 hover:underline">
            {label}
          </Link>
        )
      },
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: t('data_quality.findings.columns.severity', 'Severity'),
      cell: ({ getValue }) => String(getValue() ?? '—'),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: t('data_quality.findings.columns.status', 'Status'),
    },
    {
      id: 'message',
      accessorKey: 'message',
      header: t('data_quality.findings.columns.message', 'Message'),
      cell: ({ row }) => <span className="line-clamp-2">{row.original.message}</span>,
    },
    {
      id: 'lastSeenAt',
      accessorKey: 'lastSeenAt',
      header: t('data_quality.findings.columns.lastSeen', 'Last Seen'),
      cell: ({ row }) => formatDateTime(row.original.lastSeenAt),
    },
  ], [t])

  const runFindingAction = React.useCallback(async (finding: Finding, action: 'resolve' | 'ignore') => {
    const confirmed = await confirm({
      title: action === 'resolve'
        ? t('data_quality.findings.resolveConfirm', 'Mark this finding as resolved?')
        : t('data_quality.findings.ignoreConfirm', 'Ignore this finding? It will not reopen on future scans.'),
    })
    if (!confirmed) return

    setPendingId(finding.id)
    try {
      const response = await runMutation({
        operation: () => apiCall(`/api/data_quality/findings/${encodeURIComponent(finding.id)}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        }),
        context: { findingId: finding.id, action },
        mutationPayload: { findingId: finding.id, action },
      })

      if (!response.ok) {
        await raiseCrudError(response.response, t('data_quality.errors.findingActionFailed', 'Failed to update the finding.'))
      }

      flash(
        action === 'resolve'
          ? t('data_quality.findings.resolveSuccess', 'Finding resolved.')
          : t('data_quality.findings.ignoreSuccess', 'Finding ignored.'),
        'success',
      )
      await queryClient.invalidateQueries({ queryKey: ['data_quality_findings'] })
    } catch (nextError) {
      flash(
        nextError instanceof Error ? nextError.message : t('data_quality.errors.findingActionFailed', 'Failed to update the finding.'),
        'error',
      )
    } finally {
      setPendingId(null)
    }
  }, [confirm, queryClient, runMutation, t])

  return (
    <>
      {ConfirmDialogElement}
      <DataTable
        title={title ?? t('data_quality.findings.title', 'Findings')}
        data={data?.items ?? []}
        columns={columns}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : undefined}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t('data_quality.findings.searchPlaceholder', 'Search findings')}
        refreshButton={{
          label: t('common.refresh', 'Refresh'),
          onRefresh: () => { void refetch() },
          isRefreshing: isFetching,
        }}
        rowActions={(row) => row.status === 'open' ? [
          {
            id: 'resolve',
            label: t('data_quality.findings.resolve', 'Resolve'),
            icon: CheckCircle,
            onClick: () => { void runFindingAction(row, 'resolve') },
            disabled: pendingId === row.id,
          },
          {
            id: 'ignore',
            label: t('data_quality.findings.ignore', 'Ignore'),
            icon: XCircle,
            onClick: () => { void runFindingAction(row, 'ignore') },
            disabled: pendingId === row.id,
          },
        ] : []}
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
            {t('data_quality.findings.empty', 'No findings recorded.')}
          </div>
        )}
      />
    </>
  )
}
