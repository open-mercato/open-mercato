'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type LedgerAccountTypeRow = {
  id: string
  slug: string
  name: string
  normalBalance: 'DEBIT' | 'CREDIT'
  parentAccountTypeId: string | null
  accountGroupId: string | null
  organizationId: string
  tenantId: string
  createdAt: string | null
  updatedAt: string | null
}

type ResponsePayload = {
  items: LedgerAccountTypeRow[]
  total: number
  page: number
  totalPages: number
}

export default function LedgerAccountTypesPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<LedgerAccountTypeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const mutationContextId = 'ledger-account-types-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        if (filters.normalBalance) params.set('normalBalance', String(filters.normalBalance))

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/ledger/account-types?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(t('ledger.account_types.list.error.load', 'Failed to load account types'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch {
        if (!cancelled) flash(t('ledger.account_types.list.error.load', 'Failed to load account types'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, search, filters, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(
    async (row: LedgerAccountTypeRow) => {
      const confirmed = await confirmDialog({
        title: t('ledger.account_types.list.confirmDelete', 'Delete account type {{slug}}?', { slug: row.slug }),
        variant: 'destructive',
      })
      if (!confirmed) return

      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt),
              () => apiCall('/api/ledger/account-types', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: row.id, organizationId: row.organizationId, tenantId: row.tenantId }),
              }),
            )
            if (!call.ok) {
              throw Object.assign(new Error('[internal] ledger.account_types.delete failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: 'ledger.ledger_account_type',
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })

        flash(t('ledger.account_types.flash.deleted', 'Account type deleted'), 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((token) => token + 1) })) return
        flash(t('ledger.account_types.flash.deleteError', 'Could not delete this account type'), 'error')
      }
    },
    [t, confirmDialog, mutationContextId, retryLastMutation, runMutation],
  )

  const columns = React.useMemo<ColumnDef<LedgerAccountTypeRow>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: t('ledger.account_types.list.columns.slug', 'Slug'),
        cell: ({ row }) => <span className="font-mono font-medium">{row.original.slug}</span>,
      },
      {
        accessorKey: 'name',
        header: t('ledger.account_types.list.columns.name', 'Name'),
      },
      {
        accessorKey: 'normalBalance',
        header: t('ledger.account_types.list.columns.normalBalance', 'Normal balance'),
        cell: ({ row }) => (
          <Badge variant={row.original.normalBalance === 'DEBIT' ? 'default' : 'secondary'}>
            {row.original.normalBalance === 'DEBIT'
              ? t('ledger.common.debit', 'Debit')
              : t('ledger.common.credit', 'Credit')}
          </Badge>
        ),
      },
      {
        accessorKey: 'parentAccountTypeId',
        header: t('ledger.account_types.list.columns.parent', 'Parent type'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.parentAccountTypeId ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('ledger.account_types.list.columns.createdAt', 'Created'),
        cell: ({ row }) => (row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—'),
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'normalBalance',
        label: t('ledger.account_types.list.filters.normalBalance', 'Normal balance'),
        type: 'select',
        options: [
          { label: t('ledger.account_types.list.filters.all', 'All'), value: '' },
          { label: t('ledger.common.debit', 'Debit'), value: 'DEBIT' },
          { label: t('ledger.common.credit', 'Credit'), value: 'CREDIT' },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('ledger.account_types.list.title', 'Account Types')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('ledger.account_types.list.searchPlaceholder', 'Search account types…')}
          filters={filterDefs}
          filterValues={filters}
          onFiltersApply={(values) => {
            setFilters(values)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilters({})
            setPage(1)
          }}
          actions={
            <Button asChild>
              <Link href="/backend/ledger/account-types/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('ledger.account_types.list.actions.create', 'New account type')}
              </Link>
            </Button>
          }
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit'), href: `/backend/ledger/account-types/${row.id}` },
                { id: 'delete', label: t('common.delete'), destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('ledger.account_types.list.title', 'Account Types')}
              createHref="/backend/ledger/account-types/create"
              createLabel={t('ledger.account_types.list.actions.create', 'New account type')}
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
