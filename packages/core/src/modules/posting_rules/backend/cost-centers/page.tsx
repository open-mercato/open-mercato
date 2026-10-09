"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { ClearingAccountBanner } from '../../components/ClearingAccountBanner'

type Row = {
  id: string
  code: string
  name: string
  isActive: boolean
  updatedAt: string | null
}

export default function CostCentersListPage() {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'code', desc: false }])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [rows, setRows] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        const fallback = { items: [], total: 0, totalPages: 1 }
        const j = await readApiResultOrThrow<{ items?: Row[]; total?: number; totalPages?: number }>(
          `/api/posting_rules/cost-centers?${params.toString()}`,
          undefined,
          { errorMessage: t('posting_rules.cost_centers.list.error.load', 'Failed to load cost centres'), fallback },
        )
        if (!cancelled) {
          setRows(j.items || [])
          setTotal(j.total || 0)
          setTotalPages(j.totalPages || 1)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    const confirmed = await confirm({
      title: t('posting_rules.cost_centers.list.confirmDelete', 'Delete cost centre "{{name}}"?').replace('{{name}}', row.name),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(row.updatedAt),
        () => apiCall(`/api/posting_rules/cost-centers?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('posting_rules.cost_centers.list.error.delete', 'Failed to delete cost centre'))
      }
      flash(t('posting_rules.cost_centers.list.success.delete', 'Cost centre deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('posting_rules.cost_centers.list.error.delete', 'Failed to delete cost centre')
      flash(message, 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'code', header: t('posting_rules.cost_centers.list.columns.code', 'Code') },
    { accessorKey: 'name', header: t('posting_rules.cost_centers.list.columns.name', 'Name') },
    {
      accessorKey: 'isActive',
      header: t('posting_rules.cost_centers.list.columns.isActive', 'Active'),
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? t('common.yes', 'Yes') : t('common.no', 'No')}
        </Badge>
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <ClearingAccountBanner />
        <DataTable
          title={t('posting_rules.cost_centers.list.title', 'Cost centres')}
          titleHeadingLevel={1}
          actions={(
            <Button asChild>
              <Link href="/backend/cost-centers/create">{t('posting_rules.cost_centers.list.actions.create', 'Create')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/cost-centers/${row.id}` },
              { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          emptyState={(
            <ListEmptyState
              entityName={t('posting_rules.cost_centers.list.title', 'Cost centres')}
              createHref="/backend/cost-centers/create"
              createLabel={t('posting_rules.cost_centers.list.actions.create', 'Create')}
            />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
