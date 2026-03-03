"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ApprovalRow = {
  id: string
  status: string
  runId: string
  reason?: string | null
  requestedAt?: string | null
}

type ApprovalsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapRow(input: Record<string, unknown>): ApprovalRow | null {
  const id = typeof input.id === 'string' ? input.id : null
  if (!id) return null

  const run = input.run
  const runId =
    (run && typeof run === 'object' && typeof (run as Record<string, unknown>).id === 'string'
      ? (run as Record<string, unknown>).id as string
      : null) ??
    (typeof input.runId === 'string' ? input.runId : null) ??
    ''

  return {
    id,
    status: typeof input.status === 'string' ? input.status : 'pending',
    runId,
    reason: typeof input.reason === 'string' ? input.reason : null,
    requestedAt:
      (typeof input.requested_at === 'string' ? input.requested_at : null) ??
      (typeof input.requestedAt === 'string' ? input.requestedAt : null),
  }
}

async function resolveApproval(id: string, action: 'approve' | 'reject'): Promise<void> {
  await apiCall(`/api/agent_governance/approvals/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ comment: `Resolved from approvals table: ${action}` }),
  })
}

export default function AgentGovernanceApprovalsPage() {
  const t = useT()

  const [rows, setRows] = React.useState<ApprovalRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'requestedAt', desc: true }])
  const [reloadToken, setReloadToken] = React.useState(0)

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '50')
      if (search.trim()) params.set('status', search.trim())

      const response = await apiCall<ApprovalsResponse>(`/api/agent_governance/approvals?${params.toString()}`)
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      setRows(items.map((item) => mapRow(item)).filter((item): item is ApprovalRow => item !== null))
      setTotal(typeof response.result?.total === 'number' ? response.result.total : 0)
      setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
    } catch {
      flash(t('agent_governance.approvals.loadError', 'Failed to load approvals.'), 'error')
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [page, search, t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, reloadToken])

  const handleResolve = React.useCallback(async (row: ApprovalRow, action: 'approve' | 'reject') => {
    try {
      await resolveApproval(row.id, action)
      flash(t('agent_governance.approvals.resolveSuccess', 'Approval resolved.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.approvals.resolveError', 'Failed to resolve approval.'), 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<ApprovalRow>[]>(() => [
    { accessorKey: 'status', header: t('agent_governance.approvals.columns.status', 'Status') },
    {
      accessorKey: 'runId',
      header: t('agent_governance.approvals.columns.runId', 'Run'),
      cell: ({ row }) => row.original.runId ? (
        <Link className="text-primary underline-offset-2 hover:underline" href={`/backend/agent-governance/runs/${row.original.runId}`}>
          {row.original.runId}
        </Link>
      ) : '—',
    },
    { accessorKey: 'reason', header: t('agent_governance.approvals.columns.reason', 'Reason') },
    {
      accessorKey: 'requestedAt',
      header: t('agent_governance.approvals.columns.requestedAt', 'Requested'),
      cell: ({ row }) => row.original.requestedAt ? new Date(row.original.requestedAt).toLocaleString() : '—',
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('agent_governance.approvals.title', 'Approvals')}
          actions={<Button asChild variant="outline"><Link href="/backend/agent-governance/runs">{t('agent_governance.nav.runs', 'Runs')}</Link></Button>}
          columns={columns}
          data={rows}
          searchPlaceholder={t('agent_governance.approvals.searchPlaceholder', 'Filter by status')}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'open', label: t('common.open', 'Open run'), href: `/backend/agent-governance/runs/${row.runId}` },
                { id: 'approve', label: t('agent_governance.approvals.actions.approve', 'Approve'), onSelect: () => { void handleResolve(row, 'approve') } },
                { id: 'reject', label: t('agent_governance.approvals.actions.reject', 'Reject'), destructive: true, onSelect: () => { void handleResolve(row, 'reject') } },
              ]}
            />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'agent_governance.approvals.list' }}
        />
      </PageBody>
    </Page>
  )
}
