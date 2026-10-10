"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import Link from 'next/link'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useDirection, useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { buildAbstractListParams } from '../lib/listParams'
import { useInitialFilters } from '../lib/useInitialFilters'
import { ABSTRACT_STATUS_FALLBACKS, ABSTRACT_STATUS_VALUES } from '../lib/freightEnums'
import { customerNameOf, formatFreightAmount, formatFreightDate, useCustomerOptions } from './freightOptions'
import { LIST_HREF } from './abstractListMeta'
import { GenerateAbstractDialog } from './GenerateAbstractDialog'
import { AbstractActionDialog, type AbstractActionTarget, type AbstractNoteAction } from './AbstractActionDialog'
import type { AbstractStatus } from '../data/entities'

export const RESOURCE = 'freight_operations/abstracts'
export const detailHref = (id: string) => `/backend/freight/abstracts/${id}`
export const ENTITY_ID = 'freight_operations:freight_trip_abstract'

const INITIAL_FILTER_KEYS = ['status', 'approvalMode', 'contractId', 'customerId', 'q']

const LIST_MUTATION_CONTEXT_ID = 'freight_operations.abstracts.list'

type AbstractDirectAction = 'submit' | 'invoice'

const DIRECT_ACTION_FALLBACKS: Record<AbstractDirectAction, { confirm: string; success: string; error: string }> = {
  submit: {
    confirm: 'Submit this abstract to the customer for review?',
    success: 'Abstract submitted.',
    error: 'Unable to submit the abstract.',
  },
  invoice: {
    confirm: 'Issue a tax invoice for this abstract? This creates a sales order and invoice.',
    success: 'Invoice issued.',
    error: 'Unable to issue the invoice.',
  },
}

export type FreightAbstractRow = {
  id: string
  abstract_number: string
  contract_id: string
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  period_from?: string | null
  period_to?: string | null
  status: AbstractStatus
  requires_customer_approval?: boolean | null
  approval_mode?: string | null
  trip_count?: number | null
  subtotal_net_amount?: string | null
  tax_total_amount?: string | null
  grand_total_gross_amount?: string | null
  currency_code: string
  sales_invoice_id?: string | null
  sales_invoice_number?: string | null
  outstanding_amount?: string | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const APPROVAL_MODE_FALLBACKS: Record<string, string> = {
  customer_portal: 'Customer portal',
  customer_offline: 'Recorded offline',
  staff_internal: 'Staff finalized',
}

export default function FreightAbstractsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: LIST_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const initialFilters = useInitialFilters(INITIAL_FILTER_KEYS)
  const [values, setValues] = React.useState<FilterValues>(initialFilters)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])
  const [page, setPage] = React.useState(1)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [noteAction, setNoteAction] = React.useState<AbstractNoteAction | null>(null)
  const [actionTarget, setActionTarget] = React.useState<AbstractActionTarget | null>(null)

  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const { options: customerOptions, byId } = useCustomerOptions()
  const params = React.useMemo(() => buildAbstractListParams(values, page, sorting), [page, sorting, values])

  const query = useQuery({
    queryKey: ['freight-abstracts', params, scopeVersion],
    queryFn: () => fetchCrudList<FreightAbstractRow>(RESOURCE, params),
  })

  const data = query.data

  const runDirectAction = React.useCallback(async (row: FreightAbstractRow, action: AbstractDirectAction) => {
    const confirmed = await confirm({ title: t(`freight_operations.abstracts.actions.${action}.confirm`, DIRECT_ACTION_FALLBACKS[action].confirm) })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/abstracts/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: row.id }),
          }, { errorMessage: DIRECT_ACTION_FALLBACKS[action].error }),
        ),
        mutationPayload: { operation: `abstracts.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: { formId: LIST_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.id, retryLastMutation },
      })
      flash(t(`freight_operations.abstracts.actions.${action}.success`, DIRECT_ACTION_FALLBACKS[action].success), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : DIRECT_ACTION_FALLBACKS[action].error, 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const openNoteAction = React.useCallback((row: FreightAbstractRow, action: AbstractNoteAction) => {
    setActionTarget({
      id: row.id,
      abstractNumber: row.abstract_number,
      updatedAt: row.updatedAt ?? null,
      updated_at: row.updated_at ?? null,
    })
    setNoteAction(action)
  }, [])

  const columns = React.useMemo<ColumnDef<FreightAbstractRow>[]>(() => [
    {
      accessorKey: 'abstract_number',
      header: t('freight_operations.abstracts.columns.number', 'Abstract'),
      cell: ({ row }) => (
        <Link href={detailHref(row.original.id)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {row.original.abstract_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('freight_operations.abstracts.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '') || byId.get(row.original.customer_id)?.displayName || '—'
        return <span className="text-sm">{name}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'period',
      header: t('freight_operations.abstracts.columns.period', 'Period'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {[formatFreightDate(row.original.period_from, locale), formatFreightDate(row.original.period_to, locale)].join(' → ')}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'trips',
      header: t('freight_operations.abstracts.columns.trips', 'Trips'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm">{row.original.trip_count ?? 0}</span>,
      meta: { priority: 3 },
    },
    {
      id: 'total',
      header: t('freight_operations.abstracts.columns.total', 'Total (gross)'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{formatFreightAmount(row.original.grand_total_gross_amount ?? '0', row.original.currency_code)}</span>
          {Number(row.original.outstanding_amount ?? 0) > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('freight_operations.abstracts.columns.outstanding', 'Outstanding {amount}', {
                amount: formatFreightAmount(row.original.outstanding_amount ?? '0', row.original.currency_code),
              })}
            </span>
          ) : null}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'status',
      header: t('freight_operations.abstracts.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`freight_operations.abstracts.status.${value}`, ABSTRACT_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
    {
      id: 'invoice',
      header: t('freight_operations.abstracts.columns.invoice', 'Invoice'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.sales_invoice_number ?? '—'}</span>
      ),
      meta: { priority: 3 },
    },
  ], [byId, locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('freight_operations.abstracts.error.load', 'Failed to load abstracts.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('freight_operations.abstracts.page.title', 'Trip abstracts')}
        titleHeadingLevel={1}
        actions={(
          <Button type="button" onClick={() => setGenerateOpen(true)}>
            {t('freight_operations.abstracts.generate.open', 'Generate abstract')}
          </Button>
        )}
        searchValue={typeof values.q === 'string' ? values.q : ''}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t('freight_operations.abstracts.search.placeholder', 'Abstract number or invoice number')}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('freight_operations.abstracts.actions.view', 'View'), href: detailHref(row.id) },
              ...(row.status === 'draft' && row.requires_customer_approval
                ? [{ id: 'submit', label: t('freight_operations.abstracts.actions.submit.label', 'Submit to customer'), onSelect: () => { void runDirectAction(row, 'submit') } }]
                : []),
              ...(row.status === 'draft' && row.requires_customer_approval === false
                ? [{ id: 'finalize', label: t('freight_operations.abstracts.actions.finalize.label', 'Finalize internally'), onSelect: () => openNoteAction(row, 'finalize') }]
                : []),
              ...(row.status === 'submitted'
                ? [{ id: 'offline-approval', label: t('freight_operations.abstracts.actions.record-offline-approval.label', 'Record offline approval'), onSelect: () => openNoteAction(row, 'record-offline-approval') }]
                : []),
              ...(row.status === 'approved'
                ? [{ id: 'invoice', label: t('freight_operations.abstracts.actions.invoice.label', 'Issue invoice'), onSelect: () => { void runDirectAction(row, 'invoice') } }]
                : []),
              ...(row.status !== 'invoiced' && row.status !== 'cancelled'
                ? [{ id: 'cancel', label: t('freight_operations.abstracts.actions.cancel.label', 'Cancel'), destructive: true, onSelect: () => openNoteAction(row, 'cancel') }]
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
            label: t('freight_operations.abstracts.filters.status', 'Status'),
            type: 'select',
            options: ABSTRACT_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.abstracts.status.${value}`, ABSTRACT_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'approvalMode',
            label: t('freight_operations.abstracts.filters.approvalMode', 'Approval'),
            type: 'select',
            options: Object.entries(APPROVAL_MODE_FALLBACKS).map(([value, label]) => ({
              value,
              label: t(`freight_operations.abstracts.approval_mode.${value}`, label),
            })),
          },
          {
            id: 'customerId',
            label: t('freight_operations.abstracts.filters.customer', 'Customer'),
            type: 'select',
            options: customerOptions,
          },
          {
            id: 'periodRange',
            label: t('freight_operations.abstracts.filters.period', 'Period'),
            type: 'dateRange',
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

      <GenerateAbstractDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onGenerated={() => { void query.refetch() }}
      />
      <AbstractActionDialog
        action={noteAction}
        target={actionTarget}
        onOpenChange={(open) => {
          if (!open) {
            setNoteAction(null)
            setActionTarget(null)
          }
        }}
        onDone={() => {
          setNoteAction(null)
          setActionTarget(null)
          void query.refetch()
        }}
      />
      {ConfirmDialogElement}
    </>
  )
}
