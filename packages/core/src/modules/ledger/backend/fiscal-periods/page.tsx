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
import { Plus, Lock, Unlock } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type FiscalPeriodRow = {
  id: string
  startDate: string
  endDate: string
  isLocked: boolean
  organizationId: string
  tenantId: string
  createdAt: string | null
  updatedAt: string | null
}

type ResponsePayload = {
  items: FiscalPeriodRow[]
  total: number
  page: number
  totalPages: number
}

// `lock`/`unlock` are custom write routes, not a field-level CRUD edit — see
// api/fiscal-periods/[id]/lock/route.ts's own header comment. Both return the
// same `FiscalPeriodDto` shape as the command.
type FiscalPeriodDto = { id: string; isLocked: boolean; updatedAt: string }

export default function FiscalPeriodsPage() {
  const t = useT()
  const [rows, setRows] = React.useState<FiscalPeriodRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const mutationContextId = 'ledger-fiscal-periods-list:mutation'
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
        if (filters.isLocked === 'true') params.set('isLocked', 'true')
        if (filters.isLocked === 'false') params.set('isLocked', 'false')

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/ledger/fiscal-periods?${params.toString()}`, undefined, {
          fallback,
        })
        if (!call.ok) {
          flash(t('ledger.fiscal_periods.list.error.load', 'Failed to load fiscal periods'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch {
        if (!cancelled) flash(t('ledger.fiscal_periods.list.error.load', 'Failed to load fiscal periods'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [page, filters, reloadToken, scopeVersion, t])

  const toggleLock = React.useCallback(
    async (row: FiscalPeriodRow, lock: boolean) => {
      if (lock) {
        const confirmed = await confirmDialog({
          title: t('ledger.fiscal_periods.list.confirmLock', 'Lock this fiscal period?'),
          description: t(
            'ledger.fiscal_periods.list.confirmLockDescription',
            'No journal entry may post with an operation date inside a locked period.',
          ),
        })
        if (!confirmed) return
      }

      try {
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(row.updatedAt),
              () => apiCall<FiscalPeriodDto>(`/api/ledger/fiscal-periods/${row.id}/${lock ? 'lock' : 'unlock'}`, {
                method: 'POST',
              }),
            )
            if (!call.ok) {
              throw Object.assign(new Error('[internal] ledger.fiscal_periods.toggleLock failed'), {
                status: call.status,
                ...((call.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return call
          },
          context: {
            formId: mutationContextId,
            resourceKind: 'ledger.fiscal_period',
            resourceId: row.id,
            retryLastMutation,
          },
          mutationPayload: { id: row.id },
        })

        flash(
          lock
            ? t('ledger.fiscal_periods.flash.locked', 'Fiscal period locked')
            : t('ledger.fiscal_periods.flash.unlocked', 'Fiscal period unlocked'),
          'success',
        )
        setReloadToken((token) => token + 1)
      } catch (error) {
        if (extractOptimisticLockConflict(error)) return
        if (surfaceRecordConflict(error, t, { onRefresh: () => setReloadToken((token) => token + 1) })) return
        flash(
          lock
            ? t('ledger.fiscal_periods.flash.lockError', 'Could not lock this fiscal period')
            : t('ledger.fiscal_periods.flash.unlockError', 'Could not unlock this fiscal period'),
          'error',
        )
      }
    },
    [t, confirmDialog, mutationContextId, retryLastMutation, runMutation],
  )

  const columns = React.useMemo<ColumnDef<FiscalPeriodRow>[]>(
    () => [
      {
        accessorKey: 'startDate',
        header: t('ledger.fiscal_periods.list.columns.startDate', 'Start date'),
      },
      {
        accessorKey: 'endDate',
        header: t('ledger.fiscal_periods.list.columns.endDate', 'End date'),
      },
      {
        accessorKey: 'isLocked',
        header: t('ledger.fiscal_periods.list.columns.status', 'Status'),
        cell: ({ row }) => (
          <Badge variant={row.original.isLocked ? 'destructive' : 'default'} className="gap-1">
            {row.original.isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {row.original.isLocked
              ? t('ledger.fiscal_periods.list.locked', 'Locked')
              : t('ledger.fiscal_periods.list.open', 'Open')}
          </Badge>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: t('ledger.fiscal_periods.list.columns.createdAt', 'Created'),
        cell: ({ row }) => (row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—'),
      },
    ],
    [t],
  )

  const filterDefs = React.useMemo<FilterDef[]>(
    () => [
      {
        id: 'isLocked',
        label: t('ledger.fiscal_periods.list.filters.status', 'Status'),
        type: 'select',
        options: [
          { label: t('ledger.fiscal_periods.list.filters.all', 'All'), value: '' },
          { label: t('ledger.fiscal_periods.list.open', 'Open'), value: 'false' },
          { label: t('ledger.fiscal_periods.list.locked', 'Locked'), value: 'true' },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('ledger.fiscal_periods.list.title', 'Fiscal Periods')}
          titleHeadingLevel={1}
          columns={columns}
          data={rows}
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
              <Link href="/backend/ledger/fiscal-periods/create">
                <Plus className="mr-2 h-4 w-4" />
                {t('ledger.fiscal_periods.list.actions.create', 'New fiscal period')}
              </Link>
            </Button>
          }
          rowActions={(row) => (
            <RowActions
              items={[
                row.isLocked
                  ? {
                      id: 'unlock',
                      label: t('ledger.fiscal_periods.list.actions.unlock', 'Unlock'),
                      onSelect: () => toggleLock(row, false),
                    }
                  : {
                      id: 'lock',
                      label: t('ledger.fiscal_periods.list.actions.lock', 'Lock'),
                      onSelect: () => toggleLock(row, true),
                    },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              entityName={t('ledger.fiscal_periods.list.title', 'Fiscal Periods')}
              createHref="/backend/ledger/fiscal-periods/create"
              createLabel={t('ledger.fiscal_periods.list.actions.create', 'New fiscal period')}
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
