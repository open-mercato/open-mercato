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

type SkillRow = {
  id: string
  name: string
  status: string
  sourceType: string
  updatedAt?: string | null
}

type ListResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapRow(input: Record<string, unknown>): SkillRow | null {
  const id = typeof input.id === 'string' ? input.id : null
  if (!id) return null

  return {
    id,
    name: typeof input.name === 'string' ? input.name : '',
    status: typeof input.status === 'string' ? input.status : 'draft',
    sourceType:
      (typeof input.source_type === 'string' ? input.source_type : null) ??
      (typeof input.sourceType === 'string' ? input.sourceType : null) ??
      'hybrid',
    updatedAt:
      (typeof input.updated_at === 'string' ? input.updated_at : null) ??
      (typeof input.updatedAt === 'string' ? input.updatedAt : null),
  }
}

export default function AgentGovernanceSkillsPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<SkillRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [reloadToken, setReloadToken] = React.useState(0)

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '50')
      if (search.trim()) params.set('search', search.trim())

      const response = await apiCall<ListResponse>(`/api/agent_governance/skills?${params.toString()}`)
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      setRows(items.map((item) => mapRow(item)).filter((item): item is SkillRow => item !== null))
      setTotal(typeof response.result?.total === 'number' ? response.result.total : 0)
      setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
    } catch {
      flash(t('agent_governance.skills.loadError', 'Failed to load skills.'), 'error')
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [page, search, t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, reloadToken])

  const handleDelete = React.useCallback(async (row: SkillRow) => {
    const isConfirmed = await confirm({
      title: t('agent_governance.skills.confirmDelete', 'Delete skill "{{name}}"?').replace('{{name}}', row.name),
      variant: 'destructive',
    })
    if (!isConfirmed) return

    try {
      await deleteCrud('agent_governance/skills', row.id)
      flash(t('agent_governance.skills.deleteSuccess', 'Skill deleted.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.skills.deleteError', 'Failed to delete skill.'), 'error')
    }
  }, [confirm, t])

  const handleValidate = React.useCallback(async (row: SkillRow) => {
    try {
      const response = await apiCall(`/api/agent_governance/skills/${encodeURIComponent(row.id)}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          approvalDecision: 'approve',
          passRateThreshold: 0.6,
          sampleSize: 60,
          idempotencyKey: `ui-${Date.now()}-${row.id}`,
        }),
      })
      if (!response.ok) throw new Error(t('agent_governance.skills.validateError', 'Validation failed.'))
      flash(t('agent_governance.skills.validateSuccess', 'Skill validated.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.skills.validateError', 'Validation failed.'), 'error')
    }
  }, [t])

  const handlePromote = React.useCallback(async (row: SkillRow) => {
    try {
      const response = await apiCall(`/api/agent_governance/skills/${encodeURIComponent(row.id)}/promote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `ui-${Date.now()}-${row.id}`,
        }),
      })
      if (!response.ok) throw new Error(t('agent_governance.skills.promoteError', 'Promotion failed.'))
      flash(t('agent_governance.skills.promoteSuccess', 'Skill promoted.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.skills.promoteError', 'Promotion failed.'), 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<SkillRow>[]>(() => [
    { accessorKey: 'name', header: t('agent_governance.skills.columns.name', 'Name') },
    { accessorKey: 'status', header: t('agent_governance.skills.columns.status', 'Status') },
    { accessorKey: 'sourceType', header: t('agent_governance.skills.columns.sourceType', 'Source') },
    {
      accessorKey: 'updatedAt',
      header: t('agent_governance.skills.columns.updated', 'Updated'),
      cell: ({ row }) => row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : '—',
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('agent_governance.skills.title', 'Skills')}
          actions={<Button asChild><Link href="/backend/agent-governance/skills/create">{t('common.create', 'Create')}</Link></Button>}
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
                { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/agent-governance/skills/${row.id}/edit` },
                { id: 'validate', label: t('agent_governance.skills.actions.validate', 'Validate'), onSelect: () => { void handleValidate(row) } },
                { id: 'promote', label: t('agent_governance.skills.actions.promote', 'Promote'), onSelect: () => { void handlePromote(row) } },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          perspective={{ tableId: 'agent_governance.skills.list' }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
