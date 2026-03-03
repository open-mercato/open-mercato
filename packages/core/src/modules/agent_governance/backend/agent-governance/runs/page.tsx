"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type RunRow = {
  id: string
  status: string
  autonomyMode: string
  actionType: string
  targetEntity: string
  targetId?: string | null
  createdAt?: string | null
}

type RunsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapRow(input: Record<string, unknown>): RunRow | null {
  const id = typeof input.id === 'string' ? input.id : null
  if (!id) return null

  return {
    id,
    status: typeof input.status === 'string' ? input.status : 'queued',
    autonomyMode:
      (typeof input.autonomy_mode === 'string' ? input.autonomy_mode : null) ??
      (typeof input.autonomyMode === 'string' ? input.autonomyMode : null) ??
      'propose',
    actionType:
      (typeof input.action_type === 'string' ? input.action_type : null) ??
      (typeof input.actionType === 'string' ? input.actionType : null) ??
      '',
    targetEntity:
      (typeof input.target_entity === 'string' ? input.target_entity : null) ??
      (typeof input.targetEntity === 'string' ? input.targetEntity : null) ??
      '',
    targetId:
      (typeof input.target_id === 'string' ? input.target_id : null) ??
      (typeof input.targetId === 'string' ? input.targetId : null),
    createdAt:
      (typeof input.created_at === 'string' ? input.created_at : null) ??
      (typeof input.createdAt === 'string' ? input.createdAt : null),
  }
}

async function runControl(id: string, action: 'pause' | 'resume' | 'terminate', reason?: string): Promise<void> {
  await apiCall(`/api/agent_governance/runs/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: reason ?? null }),
  })
}

export default function AgentGovernanceRunsPage() {
  const t = useT()

  const [rows, setRows] = React.useState<RunRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [reloadToken, setReloadToken] = React.useState(0)

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '50')
      if (search.trim()) params.set('status', search.trim())

      const response = await apiCall<RunsResponse>(`/api/agent_governance/runs?${params.toString()}`)
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      setRows(items.map((item) => mapRow(item)).filter((item): item is RunRow => item !== null))
      setTotal(typeof response.result?.total === 'number' ? response.result.total : 0)
      setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
    } catch {
      flash(t('agent_governance.runs.loadError', 'Failed to load runs.'), 'error')
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [page, search, t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, reloadToken])

  const handleControl = React.useCallback(async (row: RunRow, action: 'pause' | 'resume' | 'terminate') => {
    try {
      await runControl(row.id, action, `Action requested from runs table: ${action}`)
      flash(t('agent_governance.runs.controlSuccess', 'Run updated.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.runs.controlError', 'Run update failed.'), 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<RunRow>[]>(() => [
    { accessorKey: 'status', header: t('agent_governance.runs.columns.status', 'Status') },
    { accessorKey: 'autonomyMode', header: t('agent_governance.runs.columns.mode', 'Mode') },
    { accessorKey: 'actionType', header: t('agent_governance.runs.columns.actionType', 'Action') },
    { accessorKey: 'targetEntity', header: t('agent_governance.runs.columns.targetEntity', 'Target Entity') },
    {
      accessorKey: 'createdAt',
      header: t('agent_governance.runs.columns.createdAt', 'Created'),
      cell: ({ row }) => row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—',
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('agent_governance.runs.title', 'Runs')}
          actions={<Link href="/backend/agent-governance"><span className="text-sm text-muted-foreground">{t('agent_governance.runs.actions.dashboard', 'Back to dashboard')}</span></Link>}
          columns={columns}
          data={rows}
          searchPlaceholder={t('agent_governance.runs.searchPlaceholder', 'Filter by status')}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'open', label: t('common.open', 'Open'), href: `/backend/agent-governance/runs/${row.id}` },
                { id: 'pause', label: t('agent_governance.runs.actions.pause', 'Pause'), onSelect: () => { void handleControl(row, 'pause') } },
                { id: 'resume', label: t('agent_governance.runs.actions.resume', 'Resume'), onSelect: () => { void handleControl(row, 'resume') } },
                { id: 'terminate', label: t('agent_governance.runs.actions.terminate', 'Terminate'), destructive: true, onSelect: () => { void handleControl(row, 'terminate') } },
              ]}
            />
          )}
          rowClickActionIds={['open']}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'agent_governance.runs.list' }}
        />
      </PageBody>
    </Page>
  )
}
