"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type RiskBandRow = {
  id: string
  name: string
  riskLevel: string
  minScore: number
  maxScore: number
  requiresApproval: boolean
  failClosed: boolean
}

type ListResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapRow(input: Record<string, unknown>): RiskBandRow | null {
  const id = typeof input.id === 'string' ? input.id : null
  if (!id) return null

  return {
    id,
    name: typeof input.name === 'string' ? input.name : '',
    riskLevel:
      (typeof input.risk_level === 'string' ? input.risk_level : null) ??
      (typeof input.riskLevel === 'string' ? input.riskLevel : null) ??
      'low',
    minScore:
      (typeof input.min_score === 'number' ? input.min_score : null) ??
      (typeof input.minScore === 'number' ? input.minScore : null) ??
      0,
    maxScore:
      (typeof input.max_score === 'number' ? input.max_score : null) ??
      (typeof input.maxScore === 'number' ? input.maxScore : null) ??
      100,
    requiresApproval:
      (typeof input.requires_approval === 'boolean' ? input.requires_approval : null) ??
      (typeof input.requiresApproval === 'boolean' ? input.requiresApproval : null) ??
      false,
    failClosed:
      (typeof input.fail_closed === 'boolean' ? input.fail_closed : null) ??
      (typeof input.failClosed === 'boolean' ? input.failClosed : null) ??
      false,
  }
}

export default function AgentGovernanceRiskBandsPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<RiskBandRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search.trim()) params.set('search', search.trim())

        const response = await apiCall<ListResponse>(`/api/agent_governance/risk-bands?${params.toString()}`)
        const items = Array.isArray(response.result?.items) ? response.result.items : []
        if (!cancelled) {
          setRows(items.map((item) => mapRow(item)).filter((item): item is RiskBandRow => item !== null))
          setTotal(typeof response.result?.total === 'number' ? response.result.total : 0)
          setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
        }
      } catch {
        if (!cancelled) {
          flash(t('agent_governance.riskBands.loadError', 'Failed to load risk bands.'), 'error')
          setRows([])
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [page, search, reloadToken, t])

  const handleDelete = React.useCallback(async (row: RiskBandRow) => {
    const isConfirmed = await confirm({
      title: t('agent_governance.riskBands.confirmDelete', 'Delete risk band "{{name}}"?').replace('{{name}}', row.name),
      variant: 'destructive',
    })
    if (!isConfirmed) return

    try {
      await deleteCrud('agent_governance/risk-bands', row.id)
      flash(t('agent_governance.riskBands.deleteSuccess', 'Risk band deleted.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.riskBands.deleteError', 'Failed to delete risk band.'), 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<RiskBandRow>[]>(() => [
    { accessorKey: 'name', header: t('agent_governance.riskBands.columns.name', 'Name') },
    { accessorKey: 'riskLevel', header: t('agent_governance.riskBands.columns.level', 'Risk level') },
    {
      id: 'range',
      header: t('agent_governance.riskBands.columns.range', 'Score range'),
      cell: ({ row }) => `${row.original.minScore}-${row.original.maxScore}`,
    },
    {
      accessorKey: 'requiresApproval',
      header: t('agent_governance.riskBands.columns.approval', 'Requires approval'),
      cell: ({ row }) => (row.original.requiresApproval ? t('common.yes', 'Yes') : t('common.no', 'No')),
    },
    {
      accessorKey: 'failClosed',
      header: t('agent_governance.riskBands.columns.failClosed', 'Fail closed'),
      cell: ({ row }) => (row.original.failClosed ? t('common.yes', 'Yes') : t('common.no', 'No')),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('agent_governance.riskBands.title', 'Risk Bands')}
          actions={<Button asChild><Link href="/backend/agent-governance/risk-bands/create">{t('common.create', 'Create')}</Link></Button>}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/agent-governance/risk-bands/${row.id}/edit` },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'agent_governance.risk_bands.list' }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
