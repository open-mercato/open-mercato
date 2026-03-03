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

type PolicyRow = {
  id: string
  name: string
  description?: string | null
  defaultMode: string
  isActive: boolean
  createdAt?: string | null
}

type PolicyListResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

function mapPolicyRow(input: Record<string, unknown>): PolicyRow | null {
  const id = typeof input.id === 'string' ? input.id : null
  if (!id) return null

  return {
    id,
    name: typeof input.name === 'string' ? input.name : '',
    description: typeof input.description === 'string' ? input.description : null,
    defaultMode:
      (typeof input.default_mode === 'string' ? input.default_mode : null) ??
      (typeof input.defaultMode === 'string' ? input.defaultMode : null) ??
      'propose',
    isActive:
      (typeof input.is_active === 'boolean' ? input.is_active : null) ??
      (typeof input.isActive === 'boolean' ? input.isActive : null) ??
      true,
    createdAt:
      (typeof input.created_at === 'string' ? input.created_at : null) ??
      (typeof input.createdAt === 'string' ? input.createdAt : null),
  }
}

export default function AgentGovernancePoliciesPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [rows, setRows] = React.useState<PolicyRow[]>([])
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

      const response = await apiCall<PolicyListResponse>(`/api/agent_governance/policies?${params.toString()}`)
      if (!response.ok) {
        throw new Error(t('agent_governance.policies.loadError', 'Failed to load policies.'))
      }

      const items = Array.isArray(response.result?.items) ? response.result.items : []
      setRows(items.map((item) => mapPolicyRow(item)).filter((item): item is PolicyRow => item !== null))
      setTotal(typeof response.result?.total === 'number' ? response.result.total : 0)
      setTotalPages(typeof response.result?.totalPages === 'number' ? response.result.totalPages : 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.policies.loadError', 'Failed to load policies.'), 'error')
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [page, search, t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, reloadToken])

  const handleDelete = React.useCallback(async (row: PolicyRow) => {
    const isConfirmed = await confirm({
      title: t('agent_governance.policies.confirmDelete', 'Delete policy "{{name}}"?').replace('{{name}}', row.name),
      variant: 'destructive',
    })
    if (!isConfirmed) return

    try {
      await deleteCrud('agent_governance/policies', row.id)
      flash(t('agent_governance.policies.deleteSuccess', 'Policy deleted.'), 'success')
      setReloadToken((value) => value + 1)
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : t('agent_governance.policies.deleteError', 'Failed to delete policy.'), 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<PolicyRow>[]>(() => [
    { accessorKey: 'name', header: t('agent_governance.policies.columns.name', 'Name') },
    { accessorKey: 'defaultMode', header: t('agent_governance.policies.columns.mode', 'Default mode') },
    {
      accessorKey: 'isActive',
      header: t('agent_governance.policies.columns.active', 'Active'),
      cell: ({ row }) => (row.original.isActive ? t('common.yes', 'Yes') : t('common.no', 'No')),
    },
    {
      accessorKey: 'description',
      header: t('agent_governance.policies.columns.description', 'Description'),
      cell: ({ row }) => row.original.description || '—',
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('agent_governance.policies.title', 'Policies')}
          actions={<Button asChild><Link href="/backend/agent-governance/policies/create">{t('common.create', 'Create')}</Link></Button>}
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
                { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/agent-governance/policies/${row.id}/edit` },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{
            page,
            pageSize: 50,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          isLoading={isLoading}
          perspective={{ tableId: 'agent_governance.policies.list' }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
