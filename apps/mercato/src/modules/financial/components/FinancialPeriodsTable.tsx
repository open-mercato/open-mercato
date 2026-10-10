"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export const RESOURCE = 'financial/periods'
export const CREATE_HREF = '/backend/financial/periods/create'
export const editHref = (id: string) => `/backend/financial/periods/${id}/edit`
export const ENTITY_ID = 'financial:gl_period'

const LIST_MUTATION_CONTEXT_ID = 'financial.periods.list'

export type PeriodStatus = 'open' | 'soft_closed' | 'hard_closed'

export const PERIOD_STATUS_VALUES: PeriodStatus[] = ['open', 'soft_closed', 'hard_closed']

export const PERIOD_STATUS_FALLBACKS: Record<PeriodStatus, string> = {
  open: 'Open',
  soft_closed: 'Soft closed',
  hard_closed: 'Hard closed',
}

export type PeriodRow = {
  id: string
  fiscal_year: number
  period_number: number
  period_name: string
  start_date: string
  end_date: string
  status: PeriodStatus
  updated_at?: string | null
  updatedAt?: string | null
}

type PeriodMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

export default function FinancialPeriodsTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<PeriodMutationContext>({
    contextId: LIST_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'fiscal_year', desc: true }])
  const [page, setPage] = React.useState(1)

  const statusFilter = typeof values.status === 'string' ? values.status : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'fiscal_year',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    return out
  }, [page, sorting, statusFilter])

  const query = useQuery({
    queryKey: ['financial-periods', params, scopeVersion],
    queryFn: () => fetchCrudList<PeriodRow>(RESOURCE, params),
  })

  const data = query.data

  const runPeriodAction = React.useCallback(async (
    row: PeriodRow,
    action: 'soft_closed' | 'hard_closed' | 'reopen',
  ) => {
    const isReopen = action === 'reopen'
    const confirmed = await confirm({
      title: isReopen
        ? t('financial.periods.reopen.confirm', 'Reopen this accounting period?')
        : t('financial.periods.close.confirm', 'Close this accounting period?'),
    })
    if (!confirmed) return
    const successMessage = isReopen
      ? t('financial.periods.reopen.success', 'Period reopened.')
      : t('financial.periods.close.success', 'Period closed.')
    const errorFallback = isReopen
      ? t('financial.periods.reopen.error', 'Unable to reopen the period.')
      : t('financial.periods.close.error', 'Unable to close the period.')
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow(
          isReopen ? '/api/financial/periods/reopen' : '/api/financial/periods/close',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              isReopen
                ? { id: row.id }
                : { id: row.id, target: action },
            ),
          },
          { errorMessage: errorFallback },
        ),
        mutationPayload: { operation: `periods.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: {
          formId: LIST_MUTATION_CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(successMessage, 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : errorFallback, 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<PeriodRow>[]>(() => [
    {
      accessorKey: 'fiscal_year',
      header: t('financial.periods.columns.fiscalYear', 'Fiscal year'),
      cell: ({ getValue }) => <span className="tabular-nums text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'period_number',
      header: t('financial.periods.columns.periodNumber', 'Period'),
      cell: ({ getValue }) => <span className="tabular-nums text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'period_name',
      header: t('financial.periods.columns.name', 'Name'),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'start_date',
      header: t('financial.periods.columns.startDate', 'Start'),
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'end_date',
      header: t('financial.periods.columns.endDate', 'End'),
      cell: ({ getValue }) => <span className="text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'status',
      header: t('financial.periods.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as PeriodStatus
        return (
          <Badge variant="secondary">
            {t(`financial.periods.status.${value}`, PERIOD_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('financial.periods.error.load', 'Failed to load periods.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('financial.periods.page.title', 'Accounting periods')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('financial.periods.actions.create', 'New period')}</Link>
          </Button>
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('financial.periods.actions.edit', 'Edit'), href: editHref(row.id) },
              ...(row.status === 'open'
                ? [{
                    id: 'softClose',
                    label: t('financial.periods.actions.softClose', 'Soft close'),
                    onSelect: () => { void runPeriodAction(row, 'soft_closed') },
                  }]
                : []),
              ...(row.status === 'soft_closed'
                ? [
                    {
                      id: 'hardClose',
                      label: t('financial.periods.actions.hardClose', 'Hard close'),
                      onSelect: () => { void runPeriodAction(row, 'hard_closed') },
                    },
                    {
                      id: 'reopen',
                      label: t('financial.periods.actions.reopen', 'Reopen'),
                      onSelect: () => { void runPeriodAction(row, 'reopen') },
                    },
                  ]
                : []),
            ]}
          />
        )}
        columns={columns}
        data={data?.items ?? []}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('financial.periods.filters.status', 'Status'),
            type: 'select',
            options: PERIOD_STATUS_VALUES.map((value) => ({
              value,
              label: t(`financial.periods.status.${value}`, PERIOD_STATUS_FALLBACKS[value]),
            })),
          },
        ]}
        filterValues={values}
        onFiltersApply={(next: FilterValues) => {
          setValues(next)
          setPage(1)
        }}
        onFiltersClear={() => {
          setValues({})
          setPage(1)
        }}
        entityId={ENTITY_ID}
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        pagination={{
          page,
          pageSize: 50,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={query.isLoading}
      />
      {ConfirmDialogElement}
    </>
  )
}

