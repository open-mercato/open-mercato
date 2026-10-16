'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Plus, Upload } from 'lucide-react'
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
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { loadLedgerAccountTypeLabelsByIds } from '../../lib/optionLoaders'
import { DEFAULT_CHART_OF_ACCOUNTS_PL } from '../../../lib/defaultChartOfAccounts'

type LedgerAccountRow = {
  id: string
  number: string
  accountTypeId: string
  description: string | null
  organizationId: string
  tenantId: string
  createdAt: string | null
  updatedAt: string | null
}

type ResponsePayload = {
  items: LedgerAccountRow[]
  total: number
  page: number
  totalPages: number
  totalIsCapped?: boolean
}

// Shown in the import confirmation. Derived from the template itself so the
// text cannot drift from what the import creates (it did, in de/es/ko, when
// the counts were literals in each locale).
const DEFAULT_CHART_COUNTS = {
  typeCount: DEFAULT_CHART_OF_ACCOUNTS_PL.length,
  accountCount: DEFAULT_CHART_OF_ACCOUNTS_PL.reduce((sum, type) => sum + type.accounts.length, 0),
}

export default function LedgerAccountsPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  // The create/edit pages already require `ledger.accounts.manage` at the
  // route level, but this list page only requires `ledger.accounts.view`
  // (correctly — view-only users should see the chart of accounts). It was
  // rendering New/Edit/Delete to those same view-only users with no
  // client-side check, so the only thing stopping them was hitting the
  // gated page after the fact.
  const { payload } = useBackendChrome()
  const canManage = hasFeature(payload?.grantedFeatures, 'ledger.accounts.manage')
  const [rows, setRows] = React.useState<LedgerAccountRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
  // Whether the chart has no accounts at all, taken from the last *unsearched*
  // load (a search that matches nothing says nothing about the chart). `null`
  // until the first load answers, so the import action never flashes up for a
  // chart that already has accounts. The import command refuses a non-empty
  // chart with a 409, so the button is only offered while it can succeed
  // (PR #6439 review, point 1).
  const [chartIsEmpty, setChartIsEmpty] = React.useState<boolean | null>(null)
  const [search, setSearch] = React.useState('')
  const [filters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [refLabels, setRefLabels] = React.useState<Record<string, string>>({})
  const scopeVersion = useOrganizationScopeVersion()
  const mutationContextId = 'ledger-accounts-list:mutation'
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

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/ledger/accounts?${params.toString()}`, undefined, {
          fallback,
        })
        if (!call.ok) {
          flash(t('ledger.accounts.list.error.load', 'Failed to load accounts'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          const items = Array.isArray(payload.items) ? payload.items : []
          setRows(items)
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
          setTotalIsCapped(payload.totalIsCapped === true)
          if (!search) setChartIsEmpty((payload.total || 0) === 0)

          // Resolve `accountTypeId` to a human-readable label for the column
          // below, batched into one request via `?ids=` (raw UUIDs were shown
          // before). Best-effort: on failure the column keeps showing the raw id.
          const accountTypeIds = [...new Set(items.map((row) => row.accountTypeId).filter(Boolean))]
          if (accountTypeIds.length) {
            loadLedgerAccountTypeLabelsByIds(accountTypeIds)
              .then((typeLabels) => {
                if (!cancelled) setRefLabels((prev) => ({ ...prev, ...typeLabels }))
              })
              .catch(() => {
                // Best-effort only — the column falls back to the raw id.
              })
          }
        }
      } catch {
        if (!cancelled) flash(t('ledger.accounts.list.error.load', 'Failed to load accounts'), 'error')
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
    async (row: LedgerAccountRow) => {
      const confirmed = await confirmDialog({
        title: t('ledger.accounts.list.confirmDelete', 'Delete account {{number}}?', { number: row.number }),
        variant: 'destructive',
      })
      if (!confirmed) return

      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt),
              () => apiCall('/api/ledger/accounts', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: row.id, organizationId: row.organizationId, tenantId: row.tenantId }),
              }),
            )
            if (!call.ok) {
              throw Object.assign(new Error('[internal] ledger.accounts.delete failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: 'ledger.ledger_account',
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })

        flash(t('ledger.accounts.flash.deleted', 'Account deleted'), 'success')
        setReloadToken((token) => token + 1)
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((token) => token + 1) })) return
        flash(t('ledger.accounts.flash.deleteError', 'Could not delete this account'), 'error')
      }
    },
    [t, confirmDialog, mutationContextId, retryLastMutation, runMutation],
  )

  // `ledger.importDefaultChartOfAccounts` bulk-creates both `LedgerAccountType`
  // and `LedgerAccount` rows in one call, so it is guarded as its own
  // `ledger.chart_of_accounts_import` resource kind rather than either
  // entity's own CRUD resource kind (see
  // `api/accounts/import-default-chart-of-accounts/route.ts`'s own doc
  // comment). There is no per-row `resourceId` for this page-level action.
  const handleImportDefaultChartOfAccounts = React.useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t('ledger.accounts.list.confirmImport', 'Import the default chart of accounts?'),
      description: t(
        'ledger.accounts.list.confirmImportDescription',
        'This creates the default Polish chart-of-accounts template ({{typeCount}} account types, {{accountCount}} accounts). It can only run while your chart of accounts is empty.',
        DEFAULT_CHART_COUNTS,
      ),
    })
    if (!confirmed) return

    try {
      const result = await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok: true; createdAccountTypeCount: number; createdAccountCount: number }>(
            '/api/ledger/accounts/import-default-chart-of-accounts',
            { method: 'POST' },
          )
          if (!call.ok) {
            throw Object.assign(new Error('[internal] ledger.accounts.importDefaultChartOfAccounts failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call.result!
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'ledger.chart_of_accounts_import',
          resourceId: '',
          retryLastMutation,
        },
      })

      flash(
        t('ledger.accounts.flash.imported', 'Imported {{typeCount}} account types and {{accountCount}} accounts', {
          typeCount: result.createdAccountTypeCount,
          accountCount: result.createdAccountCount,
        }),
        'success',
      )
      setReloadToken((token) => token + 1)
    } catch (error) {
      // The command's own refusal (e.g. a non-empty chart of accounts) comes
      // back as `{ error: '<translated message>' }` with a 409 status (see
      // the route's own doc comment) — surface that message verbatim rather
      // than a generic one, per the spec's Backend Pages section.
      const serverMessage = (error as { error?: unknown } | null)?.error
      if (typeof serverMessage === 'string' && serverMessage.length > 0) {
        flash(serverMessage, 'error')
        return
      }
      flash(t('ledger.accounts.flash.importError', 'Could not import the default chart of accounts'), 'error')
    }
  }, [t, confirmDialog, mutationContextId, retryLastMutation, runMutation])

  const columns = React.useMemo<ColumnDef<LedgerAccountRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('ledger.accounts.list.columns.number', 'Number'),
        cell: ({ row }) => <span className="font-mono font-medium">{row.original.number}</span>,
      },
      {
        accessorKey: 'accountTypeId',
        header: t('ledger.accounts.list.columns.accountType', 'Account type'),
        enableSorting: false,
        cell: ({ row }) => {
          const id = row.original.accountTypeId
          const label = refLabels[id]
          return label ? (
            <span title={id}>{label}</span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground" title={id}>{id}</span>
          )
        },
      },
      {
        accessorKey: 'description',
        header: t('ledger.accounts.list.columns.description', 'Description'),
        cell: ({ row }) => row.original.description || '—',
      },
      {
        accessorKey: 'createdAt',
        header: t('ledger.accounts.list.columns.createdAt', 'Created'),
        cell: ({ row }) => (row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—'),
      },
    ],
    [t, refLabels],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('ledger.accounts.list.title', 'Chart of Accounts')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('ledger.accounts.list.searchPlaceholder', 'Search accounts…')}
          actions={
            canManage ? (
              <div className="flex items-center gap-2">
                {chartIsEmpty === true ? (
                  <Button variant="outline" onClick={handleImportDefaultChartOfAccounts}>
                    <Upload className="mr-2 h-4 w-4" />
                    {t('ledger.accounts.list.actions.importDefault', 'Import default chart of accounts')}
                  </Button>
                ) : null}
                <Button asChild>
                  <Link href="/backend/ledger/accounts/create">
                    <Plus className="mr-2 h-4 w-4" />
                    {t('ledger.accounts.list.actions.create', 'New account')}
                  </Link>
                </Button>
              </div>
            ) : undefined
          }
          rowActions={(row) => (
            <RowActions
              items={canManage ? [
                { id: 'edit', label: t('common.edit'), href: `/backend/ledger/accounts/${row.id}` },
                { id: 'delete', label: t('common.delete'), destructive: true, onSelect: () => handleDelete(row) },
              ] : []}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('ledger.accounts.list.title', 'Chart of Accounts')}
              createHref={canManage ? '/backend/ledger/accounts/create' : undefined}
              createLabel={t('ledger.accounts.list.actions.create', 'New account')}
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
