"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
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
import { useInitialFilters } from '../lib/useInitialFilters'
import {
  SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS,
  SUBSCRIPTION_ACCOUNT_TYPE_VALUES,
  SUBSCRIPTION_DIRECTION_FALLBACKS,
  SUBSCRIPTION_DIRECTION_VALUES,
  SUBSCRIPTION_STATUS_FALLBACKS,
  SUBSCRIPTION_STATUS_VALUES,
} from '../lib/transportEnums'
import { customerNameOf, formatStudentAmount, formatStudentDate } from './studentOptions'

export const RESOURCE = 'student_transport/subscriptions'
export const CREATE_HREF = '/backend/education/subscriptions/create'
export const editHref = (id: string) => `/backend/education/subscriptions/${id}/edit`
export const detailHref = (id: string) => `/backend/education/subscriptions/${id}`
export const ENTITY_ID = 'student_transport:student_subscription'

const LIST_MUTATION_CONTEXT_ID = 'student_transport.subscriptions.list'
const INITIAL_FILTER_KEYS = ['status', 'accountType', 'direction', 'customerId', 'q']

export type StudentSubscriptionRow = {
  id: string
  subscription_number: string
  status: string
  account_type: string
  direction: string
  duration: string
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  school_snapshot?: Record<string, unknown> | null
  student_name: string
  student_grade?: string | null
  guardian_phone?: string | null
  pickup_point?: string | null
  dropoff_point?: string | null
  route_snapshot?: Record<string, unknown> | null
  start_date?: string | null
  end_date?: string | null
  period_price: string
  currency_code: string
  updated_at?: string | null
  updatedAt?: string | null
}

function buildParams(values: FilterValues, page: number): Record<string, string | number> {
  const out: Record<string, string | number> = { page, pageSize: 50, sortField: 'student_name', sortDir: 'asc' }
  for (const key of ['status', 'accountType', 'direction', 'customerId'] as const) {
    const value = values[key]
    if (typeof value === 'string' && value.trim().length) out[key] = value.trim()
  }
  const search = values.q
  if (typeof search === 'string' && search.trim().length) out.search = search.trim()
  return out
}

export default function SubscriptionTable() {
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
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const params = React.useMemo(() => buildParams(values, page), [page, values])
  const query = useQuery({
    queryKey: ['student-subscriptions', params, scopeVersion],
    queryFn: () => fetchCrudList<StudentSubscriptionRow>(RESOURCE, params),
  })
  const data = query.data

  const runAction = React.useCallback(async (row: StudentSubscriptionRow, action: 'activate' | 'suspend' | 'end') => {
    if (action !== 'activate') {
      const confirmed = await confirm({
        title: action === 'end'
          ? t('student_transport.subscriptions.actions.end.confirm', 'End this subscription? No further attendance is recorded on it.')
          : t('student_transport.subscriptions.actions.suspend.confirm', 'Suspend this subscription?'),
        variant: action === 'end' ? 'destructive' : 'default',
      })
      if (!confirmed) return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => apiCallOrThrow(`/api/student_transport/subscriptions/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: row.id }),
          }, { errorMessage: t('student_transport.errors.action_failed', 'The action could not be completed.') }),
        ),
        mutationPayload: { operation: `subscriptions.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: { formId: LIST_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.id, retryLastMutation },
      })
      flash(t(`student_transport.subscriptions.actions.${action}.success`, 'Subscription updated.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('student_transport.errors.action_failed', 'The action could not be completed.'), 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<StudentSubscriptionRow>[]>(() => [
    {
      accessorKey: 'subscription_number',
      header: t('student_transport.subscriptions.columns.number', 'Subscription'),
      cell: ({ row }) => (
        <Link href={detailHref(row.original.id)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {row.original.subscription_number}
        </Link>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'student_name',
      header: t('student_transport.subscriptions.columns.student', 'Student'),
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">{row.original.student_name}</span>
          <span className="text-xs text-muted-foreground">{row.original.student_grade ?? '—'}</span>
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'payer',
      header: t('student_transport.subscriptions.columns.payer', 'Billed to'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '')
        const school = customerNameOf(row.original.school_snapshot, '')
        return (
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">{name || '—'}</span>
            <span className="text-xs text-muted-foreground">
              {t(`student_transport.account_type.${row.original.account_type}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[row.original.account_type] ?? row.original.account_type)}
              {row.original.account_type === 'b2c' && school ? ` · ${school}` : ''}
            </span>
          </span>
        )
      },
      meta: { priority: 2 },
    },
    {
      id: 'direction',
      header: t('student_transport.subscriptions.columns.direction', 'Direction'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`student_transport.direction.${row.original.direction}`, SUBSCRIPTION_DIRECTION_FALLBACKS[row.original.direction] ?? row.original.direction)}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'route',
      header: t('student_transport.subscriptions.columns.route', 'Pickup'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col text-sm">
          <span className="truncate">{row.original.pickup_point ?? '—'}</span>
          <span className="truncate text-xs text-muted-foreground">{row.original.dropoff_point ?? '—'}</span>
        </span>
      ),
      meta: { priority: 3, truncate: true, maxWidth: '18rem' },
    },
    {
      id: 'window',
      header: t('student_transport.subscriptions.columns.window', 'Window'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {[formatStudentDate(row.original.start_date, locale), formatStudentDate(row.original.end_date, locale)].join(' → ')}
        </span>
      ),
      meta: { priority: 3 },
    },
    {
      id: 'price',
      header: t('student_transport.subscriptions.columns.price', 'Per period'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatStudentAmount(row.original.period_price, row.original.currency_code)}</span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('student_transport.subscriptions.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`student_transport.status.${value}`, SUBSCRIPTION_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
  ], [locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('student_transport.subscriptions.error.load', 'Failed to load subscriptions.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('student_transport.subscriptions.page.title', 'Student subscriptions')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('student_transport.subscriptions.actions.create', 'New subscription')}</Link>
          </Button>
        )}
        searchValue={typeof values.q === 'string' ? values.q : ''}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t('student_transport.subscriptions.search.placeholder', 'Student, subscription number or guardian phone')}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('student_transport.subscriptions.actions.view', 'View'), href: detailHref(row.id) },
              ...(row.status !== 'ended'
                ? [{ id: 'edit', label: t('student_transport.subscriptions.actions.edit', 'Edit'), href: editHref(row.id) }]
                : []),
              ...(row.status === 'draft' || row.status === 'suspended'
                ? [{ id: 'activate', label: t('student_transport.subscriptions.actions.activate.label', 'Activate'), onSelect: () => { void runAction(row, 'activate') } }]
                : []),
              ...(row.status === 'active'
                ? [{ id: 'suspend', label: t('student_transport.subscriptions.actions.suspend.label', 'Suspend'), onSelect: () => { void runAction(row, 'suspend') } }]
                : []),
              ...(row.status !== 'ended'
                ? [{ id: 'end', label: t('student_transport.subscriptions.actions.end.label', 'End'), destructive: true, onSelect: () => { void runAction(row, 'end') } }]
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
            label: t('student_transport.subscriptions.filters.status', 'Status'),
            type: 'select',
            options: SUBSCRIPTION_STATUS_VALUES.map((value) => ({
              value,
              label: t(`student_transport.status.${value}`, SUBSCRIPTION_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'accountType',
            label: t('student_transport.subscriptions.filters.accountType', 'Billed to'),
            type: 'select',
            options: SUBSCRIPTION_ACCOUNT_TYPE_VALUES.map((value) => ({
              value,
              label: t(`student_transport.account_type.${value}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[value]),
            })),
          },
          {
            id: 'direction',
            label: t('student_transport.subscriptions.filters.direction', 'Direction'),
            type: 'select',
            options: SUBSCRIPTION_DIRECTION_VALUES.map((value) => ({
              value,
              label: t(`student_transport.direction.${value}`, SUBSCRIPTION_DIRECTION_FALLBACKS[value]),
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
