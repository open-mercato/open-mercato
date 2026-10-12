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
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { loadLedgerAccountGroupOptions } from '../../lib/optionLoaders'

type LedgerAccountTypeRow = {
  id: string
  number: string
  name: string
  normalBalance: 'DEBIT' | 'CREDIT'
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
  totalIsCapped?: boolean
}

export default function LedgerAccountTypesPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  // Client-side gate matching backend/accounts/page.tsx's own (view-only
  // users must not see New/Edit/Delete on this list page).
  const { payload } = useBackendChrome()
  const canManage = hasFeature(payload?.grantedFeatures, 'ledger.accounts.manage')
  const [rows, setRows] = React.useState<LedgerAccountTypeRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [groupOptions, setGroupOptions] = React.useState<Array<{ value: string; label: string }>>([])
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
        if (filters.accountGroupId) params.set('accountGroupId', String(filters.accountGroupId))

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
          const items = Array.isArray(payload.items) ? payload.items : []
          setRows(items)
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
          setTotalIsCapped(payload.totalIsCapped === true)

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

  // The zespoły are system-seeded reference data (nine rows), so they are
  // loaded once and serve both the group column and the group filter.
  React.useEffect(() => {
    let cancelled = false
    loadLedgerAccountGroupOptions()
      .then((options) => {
        if (!cancelled) setGroupOptions(options.map((option) => ({ value: String(option.value), label: option.label })))
      })
      .catch(() => {
        // Best-effort only — the column falls back to the raw id.
      })
    return () => {
      cancelled = true
    }
  }, [scopeVersion])

  const groupLabels = React.useMemo(
    () => Object.fromEntries(groupOptions.map((option) => [option.value, option.label])),
    [groupOptions],
  )

  const handleDelete = React.useCallback(
    async (row: LedgerAccountTypeRow) => {
      const confirmed = await confirmDialog({
        title: t('ledger.account_types.list.confirmDelete', 'Delete account type {{number}}?', { number: row.number }),
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
        accessorKey: 'number',
        header: t('ledger.account_types.list.columns.number', 'Number'),
        cell: ({ row }) => <span className="font-mono font-medium">{row.original.number}</span>,
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
        accessorKey: 'accountGroupId',
        header: t('ledger.account_types.list.columns.accountGroup', 'Group'),
        enableSorting: false,
        cell: ({ row }) => {
          const id = row.original.accountGroupId
          if (!id) return <span>—</span>
          const label = groupLabels[id]
          return label ? (
            <span title={id}>{label}</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground" title={id}>{id}</span>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('ledger.account_types.list.columns.createdAt', 'Created'),
        cell: ({ row }) => (row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—'),
      },
    ],
    [t, groupLabels],
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
      {
        id: 'accountGroupId',
        label: t('ledger.account_types.list.filters.accountGroup', 'Group'),
        type: 'select',
        options: [{ label: t('ledger.account_types.list.filters.all', 'All'), value: '' }, ...groupOptions],
      },
    ],
    [t, groupOptions],
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
            canManage ? (
              <Button asChild>
                <Link href="/backend/ledger/account-types/create">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('ledger.account_types.list.actions.create', 'New account type')}
                </Link>
              </Button>
            ) : undefined
          }
          rowActions={(row) => (
            <RowActions
              items={canManage ? [
                { id: 'edit', label: t('common.edit'), href: `/backend/ledger/account-types/${row.id}` },
                { id: 'delete', label: t('common.delete'), destructive: true, onSelect: () => handleDelete(row) },
              ] : []}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('ledger.account_types.list.title', 'Account Types')}
              createHref={canManage ? '/backend/ledger/account-types/create' : undefined}
              createLabel={t('ledger.account_types.list.actions.create', 'New account type')}
            />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, totalIsCapped, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
