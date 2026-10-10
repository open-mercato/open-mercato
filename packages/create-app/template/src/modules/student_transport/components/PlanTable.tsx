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
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS,
  SUBSCRIPTION_ACCOUNT_TYPE_VALUES,
  SUBSCRIPTION_DURATION_FALLBACKS,
  SUBSCRIPTION_DURATION_VALUES,
} from '../lib/transportEnums'
import { formatStudentAmount } from './studentOptions'

export const RESOURCE = 'student_transport/plans'
export const CREATE_HREF = '/backend/education/plans/create'
export const editHref = (id: string) => `/backend/education/plans/${id}/edit`
export const ENTITY_ID = 'student_transport:subscription_plan'

export type SubscriptionPlanRow = {
  id: string
  name: string
  code?: string | null
  account_type: string
  duration: string
  price_two_way: string
  price_one_way: string
  currency_code: string
  tax_rate: string
  is_active: boolean
  notes?: string | null
  updatedAt?: string | null
}

function buildParams(values: FilterValues, page: number): Record<string, string | number> {
  const out: Record<string, string | number> = { page, pageSize: 50, sortField: 'name', sortDir: 'asc' }
  for (const key of ['accountType', 'duration', 'isActive'] as const) {
    const value = values[key]
    if (typeof value === 'string' && value.trim().length) out[key] = value.trim()
  }
  const search = values.q
  if (typeof search === 'string' && search.trim().length) out.search = search.trim()
  return out
}

export default function PlanTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [values, setValues] = React.useState<FilterValues>({})
  const [page, setPage] = React.useState(1)
  const params = React.useMemo(() => buildParams(values, page), [page, values])

  const query = useQuery({
    queryKey: ['student-plans', params, scopeVersion],
    queryFn: () => fetchCrudList<SubscriptionPlanRow>(RESOURCE, params),
  })

  const columns = React.useMemo<ColumnDef<SubscriptionPlanRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('student_transport.plans.columns.name', 'Plan'),
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">{row.original.name}</span>
          {row.original.code ? <span className="text-xs text-muted-foreground">{row.original.code}</span> : null}
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'account_type',
      header: t('student_transport.plans.columns.accountType', 'Billed to'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`student_transport.account_type.${value}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
    {
      accessorKey: 'duration',
      header: t('student_transport.plans.columns.duration', 'Duration'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <span className="text-sm">
            {t(`student_transport.duration.${value}`, SUBSCRIPTION_DURATION_FALLBACKS[value] ?? value)}
          </span>
        )
      },
      meta: { priority: 2 },
    },
    {
      id: 'twoWay',
      header: t('student_transport.plans.columns.twoWay', 'Two-way price'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatStudentAmount(row.original.price_two_way, row.original.currency_code)}</span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'oneWay',
      header: t('student_transport.plans.columns.oneWay', 'One-way price'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">{formatStudentAmount(row.original.price_one_way, row.original.currency_code)}</span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'active',
      header: t('student_transport.plans.columns.status', 'Status'),
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="secondary">
          {row.original.is_active
            ? t('student_transport.plans.status.active', 'Active')
            : t('student_transport.plans.status.inactive', 'Inactive')}
        </Badge>
      ),
      meta: { priority: 3 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('student_transport.plans.error.load', 'Failed to load plans.')}</div>
  }

  return (
    <DataTable
      title={t('student_transport.plans.page.title', 'Subscription plans')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('student_transport.plans.actions.create', 'New plan')}</Link>
        </Button>
      )}
      searchValue={typeof values.q === 'string' ? values.q : ''}
      onSearchChange={(next: string) => {
        setValues((prev) => ({ ...prev, q: next }))
        setPage(1)
      }}
      searchPlaceholder={t('student_transport.plans.search.placeholder', 'Plan name or code')}
      rowActions={(row) => (
        <RowActions
          items={[
            { id: 'edit', label: t('student_transport.plans.actions.edit', 'Edit'), href: editHref(row.id) },
          ]}
        />
      )}
      columns={columns}
      data={query.data?.items ?? []}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'accountType',
          label: t('student_transport.plans.filters.accountType', 'Billed to'),
          type: 'select',
          options: SUBSCRIPTION_ACCOUNT_TYPE_VALUES.map((value) => ({
            value,
            label: t(`student_transport.account_type.${value}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[value]),
          })),
        },
        {
          id: 'duration',
          label: t('student_transport.plans.filters.duration', 'Duration'),
          type: 'select',
          options: SUBSCRIPTION_DURATION_VALUES.map((value) => ({
            value,
            label: t(`student_transport.duration.${value}`, SUBSCRIPTION_DURATION_FALLBACKS[value]),
          })),
        },
        {
          id: 'isActive',
          label: t('student_transport.plans.filters.active', 'Active'),
          type: 'select',
          options: [
            { value: 'true', label: t('student_transport.plans.status.active', 'Active') },
            { value: 'false', label: t('student_transport.plans.status.inactive', 'Inactive') },
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
      pagination={{
        page,
        pageSize: 50,
        total: query.data?.total ?? 0,
        totalPages: query.data?.totalPages ?? 0,
        totalIsCapped: query.data?.totalIsCapped === true,
        onPageChange: setPage,
      }}
      isLoading={query.isLoading}
    />
  )
}
