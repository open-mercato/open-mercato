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
import { buildContractListParams } from '../lib/listParams'
import { useInitialFilters } from '../lib/useInitialFilters'
import {
  canEditContract,
  CONTRACT_ACTION_SOURCE_STATUSES,
  type ContractAction,
} from '../lib/actionGates'
import {
  BILLING_CYCLE_FALLBACKS,
  CONTRACT_STATUS_FALLBACKS,
  CONTRACT_STATUS_VALUES,
} from '../lib/freightEnums'
import { customerNameOf, formatFreightDate, useCustomerOptions } from './freightOptions'
import type { ContractStatus } from '../data/entities'

export const RESOURCE = 'freight_operations/contracts'
export const CREATE_HREF = '/backend/freight/contracts/create'
export const editHref = (id: string) => `/backend/freight/contracts/${id}/edit`
export const detailHref = (id: string) => `/backend/freight/contracts/${id}`
export const ENTITY_ID = 'freight_operations:freight_contract'

const LIST_MUTATION_CONTEXT_ID = 'freight_operations.contracts.list'

const INITIAL_FILTER_KEYS = ['status', 'customerId', 'requiresCustomerApproval', 'q']

export type FreightContractRow = {
  id: string
  contract_number: string
  status: ContractStatus
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  title: string
  valid_from?: string | null
  valid_to?: string | null
  billing_cycle?: string | null
  payment_terms_days?: number | null
  currency_code: string
  vat_rate?: string | null
  requires_customer_approval?: boolean | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const LABEL_MISSING = '—'

const ACTION_SUCCESS_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Contract activated.',
  suspend: 'Contract suspended.',
  resume: 'Contract resumed.',
  terminate: 'Contract terminated.',
}

const ACTION_ERROR_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Unable to activate the contract.',
  suspend: 'Unable to suspend the contract.',
  resume: 'Unable to resume the contract.',
  terminate: 'Unable to terminate the contract.',
}

const ACTION_CONFIRM_FALLBACKS: Record<ContractAction, string> = {
  activate: 'Activate this contract? Trips can then be recorded against its rates.',
  suspend: 'Suspend this contract? Trips can no longer be recorded against it.',
  resume: 'Resume this contract?',
  terminate: 'Terminate this contract? This is final.',
}

export default function FreightContractsTable() {
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

  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const { options: customerOptions, byId } = useCustomerOptions()

  const params = React.useMemo(() => buildContractListParams(values, page, sorting), [page, sorting, values])

  const query = useQuery({
    queryKey: ['freight-contracts', params, scopeVersion],
    queryFn: () => fetchCrudList<FreightContractRow>(RESOURCE, params),
  })

  const data = query.data

  const runContractAction = React.useCallback(async (row: FreightContractRow, action: ContractAction) => {
    const confirmed = await confirm({
      title: t(`freight_operations.contracts.actions.${action}.confirm`, ACTION_CONFIRM_FALLBACKS[action]),
      variant: action === 'terminate' ? 'destructive' : 'default',
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/contracts/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: row.id }),
          }, { errorMessage: ACTION_ERROR_FALLBACKS[action] }),
        ),
        mutationPayload: { operation: `contracts.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: {
          formId: LIST_MUTATION_CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(t(`freight_operations.contracts.actions.${action}.success`, ACTION_SUCCESS_FALLBACKS[action]), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : ACTION_ERROR_FALLBACKS[action], 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<FreightContractRow>[]>(() => [
    {
      accessorKey: 'contract_number',
      header: t('freight_operations.contracts.columns.number', 'Contract'),
      cell: ({ row }) => (
        <Link href={detailHref(row.original.id)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {row.original.contract_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('freight_operations.contracts.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '') || byId.get(row.original.customer_id)?.displayName || LABEL_MISSING
        return <span className="text-sm">{name}</span>
      },
      meta: { priority: 1 },
    },
    {
      accessorKey: 'title',
      header: t('freight_operations.contracts.columns.title', 'Title'),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.title}
          {row.original.requires_customer_approval ? (
            <span className="ms-2 text-xs text-muted-foreground">
              {t('freight_operations.contracts.columns.approvalRequired', 'Customer approval required')}
            </span>
          ) : null}
        </span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '22rem' },
    },
    {
      id: 'validity',
      header: t('freight_operations.contracts.columns.validity', 'Validity'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {[
            formatFreightDate(row.original.valid_from, locale),
            formatFreightDate(row.original.valid_to, locale),
          ].join(' → ')}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'billing',
      header: t('freight_operations.contracts.columns.billing', 'Billing'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">
            {t(
              `freight_operations.contracts.cycle.${row.original.billing_cycle ?? 'monthly'}`,
              BILLING_CYCLE_FALLBACKS[row.original.billing_cycle ?? 'monthly'] ?? LABEL_MISSING,
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('freight_operations.contracts.columns.paymentTerms', '{days} days', { days: row.original.payment_terms_days ?? 30 })}
          </span>
        </span>
      ),
      meta: { priority: 3 },
    },
    {
      id: 'vat',
      header: t('freight_operations.contracts.columns.vat', 'VAT'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm">{`${row.original.vat_rate ?? '15'}%`}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'status',
      header: t('freight_operations.contracts.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`freight_operations.contracts.status.${value}`, CONTRACT_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
  ], [byId, locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('freight_operations.contracts.error.load', 'Failed to load contracts.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('freight_operations.contracts.page.title', 'Freight contracts')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('freight_operations.contracts.actions.create', 'New contract')}</Link>
          </Button>
        )}
        searchValue={typeof values.q === 'string' ? values.q : ''}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t('freight_operations.contracts.search.placeholder', 'Contract number or title')}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('freight_operations.contracts.actions.view', 'View'), href: detailHref(row.id) },
              ...(canEditContract(row.status)
                ? [{ id: 'edit', label: t('freight_operations.contracts.actions.edit', 'Edit'), href: editHref(row.id) }]
                : []),
              ...(CONTRACT_ACTION_SOURCE_STATUSES.activate.includes(row.status)
                ? [{ id: 'activate', label: t('freight_operations.contracts.actions.activate.label', 'Activate'), onSelect: () => { void runContractAction(row, 'activate') } }]
                : []),
              ...(CONTRACT_ACTION_SOURCE_STATUSES.suspend.includes(row.status)
                ? [{ id: 'suspend', label: t('freight_operations.contracts.actions.suspend.label', 'Suspend'), onSelect: () => { void runContractAction(row, 'suspend') } }]
                : []),
              ...(CONTRACT_ACTION_SOURCE_STATUSES.resume.includes(row.status)
                ? [{ id: 'resume', label: t('freight_operations.contracts.actions.resume.label', 'Resume'), onSelect: () => { void runContractAction(row, 'resume') } }]
                : []),
              ...(CONTRACT_ACTION_SOURCE_STATUSES.terminate.includes(row.status)
                ? [{ id: 'terminate', label: t('freight_operations.contracts.actions.terminate.label', 'Terminate'), destructive: true, onSelect: () => { void runContractAction(row, 'terminate') } }]
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
            label: t('freight_operations.contracts.filters.status', 'Status'),
            type: 'select',
            options: CONTRACT_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.contracts.status.${value}`, CONTRACT_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'customerId',
            label: t('freight_operations.contracts.filters.customer', 'Customer'),
            type: 'select',
            options: customerOptions,
          },
          {
            id: 'requiresCustomerApproval',
            label: t('freight_operations.contracts.filters.approval', 'Customer approval'),
            type: 'select',
            options: [
              { value: 'true', label: t('freight_operations.contracts.filters.approvalRequired', 'Required') },
              { value: 'false', label: t('freight_operations.contracts.filters.approvalWaived', 'Waived') },
            ],
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
