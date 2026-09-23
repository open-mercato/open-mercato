'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
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
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { loadLedgerAccountLabelsByIds, loadLedgerAccountTypeLabelsByIds } from '../lib/optionLoaders'

type LedgerAccountRow = {
  id: string
  slug: string
  accountTypeId: string
  parentAccountId: string | null
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

export default function LedgerAccountsPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<LedgerAccountRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [totalIsCapped, setTotalIsCapped] = React.useState(false)
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

          // Resolve `accountTypeId`/`parentAccountId` to human-readable labels for
          // the columns below, batched into one request per reference via `?ids=`
          // (PR #6340 review nit: raw UUIDs were shown instead). Best-effort: on
          // failure the columns just keep showing the raw id.
          const accountTypeIds = [...new Set(items.map((row) => row.accountTypeId).filter(Boolean))]
          const parentIds = [...new Set(items.map((row) => row.parentAccountId).filter((id): id is string => Boolean(id)))]
          Promise.all([
            accountTypeIds.length ? loadLedgerAccountTypeLabelsByIds(accountTypeIds) : Promise.resolve({}),
            parentIds.length ? loadLedgerAccountLabelsByIds(parentIds) : Promise.resolve({}),
          ])
            .then(([typeLabels, parentLabels]) => {
              if (!cancelled) setRefLabels((prev) => ({ ...prev, ...typeLabels, ...parentLabels }))
            })
            .catch(() => {
              // Best-effort only — the columns fall back to the raw id.
            })
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
        title: t('ledger.accounts.list.confirmDelete', 'Delete account {{slug}}?', { slug: row.slug }),
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

  const columns = React.useMemo<ColumnDef<LedgerAccountRow>[]>(
    () => [
      {
        accessorKey: 'slug',
        header: t('ledger.accounts.list.columns.slug', 'Slug'),
        cell: ({ row }) => <span className="font-mono font-medium">{row.original.slug}</span>,
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
        accessorKey: 'parentAccountId',
        header: t('ledger.accounts.list.columns.parent', 'Parent account'),
        enableSorting: false,
        cell: ({ row }) => {
          const id = row.original.parentAccountId
          if (!id) return <span>—</span>
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
            <Button asChild>
              <Link href="/backend/accounts/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('ledger.accounts.list.actions.create', 'New account')}
              </Link>
            </Button>
          }
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit'), href: `/backend/accounts/${row.id}` },
                { id: 'delete', label: t('common.delete'), destructive: true, onSelect: () => handleDelete(row) },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('ledger.accounts.list.title', 'Chart of Accounts')}
              createHref="/backend/accounts/create"
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
