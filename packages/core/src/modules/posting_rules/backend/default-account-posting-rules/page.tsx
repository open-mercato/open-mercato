"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { readApiResultOrThrow, apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { loadLedgerAccountLabelsByIds } from '../lib/optionLoaders'

type Row = {
  id: string
  sourceAccountId: string
  targetAccountId: string
  defaultCostCenterId: string | null
}

const FALLBACK_LABEL = '—'

export default function DefaultAccountPostingRulesListPage() {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [rows, setRows] = React.useState<Row[]>([])
  const [accountLabels, setAccountLabels] = React.useState<Record<string, string>>({})
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
        const fallback = { items: [], total: 0, totalPages: 1 }
        const j = await readApiResultOrThrow<{ items?: Row[]; total?: number; totalPages?: number }>(
          `/api/posting_rules/default-account-posting-rules?${params.toString()}`,
          undefined,
          { errorMessage: t('posting_rules.default_account_posting_rules.list.error.load', 'Failed to load default account posting rules'), fallback },
        )
        if (cancelled) return
        setRows(j.items || [])
        setTotal(j.total || 0)
        setTotalPages(j.totalPages || 1)
        const accountIds = [...new Set((j.items || []).flatMap((row) => [row.sourceAccountId, row.targetAccountId]))]
        if (accountIds.length) {
          const labels = await loadLedgerAccountLabelsByIds(accountIds)
          if (!cancelled) setAccountLabels(labels)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    const confirmed = await confirm({
      title: t('posting_rules.default_account_posting_rules.list.confirmDelete', 'Delete this default account posting rule?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall(`/api/posting_rules/default-account-posting-rules?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!call.ok) {
        await raiseCrudError(call.response, t('posting_rules.default_account_posting_rules.list.error.delete', 'Failed to delete default account posting rule'))
      }
      flash(t('posting_rules.default_account_posting_rules.list.success.delete', 'Default account posting rule deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('posting_rules.default_account_posting_rules.list.error.delete', 'Failed to delete default account posting rule')
      flash(message, 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'sourceAccountId',
      header: t('posting_rules.default_account_posting_rules.list.columns.sourceAccount', 'Source account (zespół 4)'),
      cell: ({ row }) => accountLabels[row.original.sourceAccountId] ?? FALLBACK_LABEL,
    },
    {
      accessorKey: 'targetAccountId',
      header: t('posting_rules.default_account_posting_rules.list.columns.targetAccount', 'Target account (zespół 5)'),
      cell: ({ row }) => accountLabels[row.original.targetAccountId] ?? FALLBACK_LABEL,
    },
  ], [t, accountLabels])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('posting_rules.default_account_posting_rules.list.title', 'Default account posting rules')}
          titleHeadingLevel={1}
          actions={(
            <Button asChild>
              <Link href="/backend/default-account-posting-rules/create">
                {t('posting_rules.default_account_posting_rules.list.actions.create', 'Create')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: t('common.edit', 'Edit'), href: `/backend/default-account-posting-rules/${row.id}` },
              { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          emptyState={(
            <ListEmptyState
              entityName={t('posting_rules.default_account_posting_rules.list.title', 'Default account posting rules')}
              createHref="/backend/default-account-posting-rules/create"
              createLabel={t('posting_rules.default_account_posting_rules.list.actions.create', 'Create')}
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
