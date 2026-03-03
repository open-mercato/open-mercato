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

type PlaybookRow = {
  id: string
  name: string
  triggerType: string
  scheduleCron?: string | null
  isActive: boolean
  policyId?: string | null
  riskBandId?: string | null
}

type ListResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapRow(input: Record<string, unknown>): PlaybookRow | null {
  const id = typeof input.id === 'string' ? input.id : null
  if (!id) return null

  return {
    id,
    name: typeof input.name === 'string' ? input.name : '',
    triggerType:
      (typeof input.trigger_type === 'string' ? input.trigger_type : null) ??
      (typeof input.triggerType === 'string' ? input.triggerType : null) ??
      'manual',
    scheduleCron:
      (typeof input.schedule_cron === 'string' ? input.schedule_cron : null) ??
      (typeof input.scheduleCron === 'string' ? input.scheduleCron : null),
    isActive:
      (typeof input.is_active === 'boolean' ? input.is_active : null) ??
      (typeof input.isActive === 'boolean' ? input.isActive : null) ??
      true,
    policyId:
      (typeof input.policy_id === 'string' ? input.policy_id : null) ??
      (typeof input.policyId === 'string' ? input.policyId : null),
    riskBandId:
      (typeof input.risk_band_id === 'string' ? input.risk_band_id : null) ??
      (typeof input.riskBandId === 'string' ? input.riskBandId : null),
  }
}

export default function AgentGovernancePlaybooksPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<PlaybookRow[]>([])
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

        const response = await apiCall<ListResponse>(`/api/agent_governance/playbooks?${params.toString()}`)
        const items = Array.isArray(response.result?.items) ? response.result.items : []
        if (!cancelled) {
          setRows(items.map((item) => mapRow(item)).filter((item): item is PlaybookRow => item !== null))
          setTotal(typeof response.result?.total === 'number' ? response.result.total : 0)
          setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
        }
      } catch {
        if (!cancelled) {
          flash(t('agent_governance.playbooks.loadError', 'Failed to load playbooks.'), 'error')
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

  const handleDelete = React.useCallback(async (row: PlaybookRow) => {
    const isConfirmed = await confirm({
      title: t('agent_governance.playbooks.confirmDelete', 'Delete playbook "{{name}}"?').replace('{{name}}', row.name),
      variant: 'destructive',
    })
    if (!isConfirmed) return

    try {
      await deleteCrud('agent_governance/playbooks', row.id)
      flash(t('agent_governance.playbooks.deleteSuccess', 'Playbook deleted.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.playbooks.deleteError', 'Failed to delete playbook.'), 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<PlaybookRow>[]>(() => [
    { accessorKey: 'name', header: t('agent_governance.playbooks.columns.name', 'Name') },
    { accessorKey: 'triggerType', header: t('agent_governance.playbooks.columns.trigger', 'Trigger') },
    {
      accessorKey: 'scheduleCron',
      header: t('agent_governance.playbooks.columns.cron', 'Schedule'),
      cell: ({ row }) => row.original.scheduleCron || '—',
    },
    {
      accessorKey: 'isActive',
      header: t('agent_governance.playbooks.columns.active', 'Active'),
      cell: ({ row }) => (row.original.isActive ? t('common.yes', 'Yes') : t('common.no', 'No')),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('agent_governance.playbooks.title', 'Playbooks')}
          actions={<Button asChild><Link href="/backend/agent-governance/playbooks/create">{t('common.create', 'Create')}</Link></Button>}
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
                { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/agent-governance/playbooks/${row.id}/edit` },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'agent_governance.playbooks.list' }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
