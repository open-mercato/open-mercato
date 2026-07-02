"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type SubscriptionRow = {
  id: string
  externalAccountId: string
  planCode: string | null
  priceCode: string | null
  productCode: string | null
  provider: string
  providerStatus: string
  providerSubscriptionId: string | null
  accessState: 'pending' | 'granted' | 'grace' | 'blocked'
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  updatedAt: string | null
}

type SubscriptionsResponse = {
  items: SubscriptionRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const ACCESS_STATE_TONE: Record<string, string> = {
  granted: 'bg-emerald-100 text-emerald-800',
  grace: 'bg-amber-100 text-amber-800',
  pending: 'bg-slate-100 text-slate-800',
  blocked: 'bg-rose-100 text-rose-800',
}

export default function SubscriptionsListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<SubscriptionRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '50' })
    if (typeof filterValues.accessState === 'string' && filterValues.accessState) {
      params.set('accessState', filterValues.accessState)
    }
    if (typeof filterValues.productCode === 'string' && filterValues.productCode) {
      params.set('productCode', filterValues.productCode)
    }
    if (typeof filterValues.externalAccountId === 'string' && filterValues.externalAccountId) {
      params.set('externalAccountId', filterValues.externalAccountId)
    }
    const fallback: SubscriptionsResponse = { items: [], total: 0, page, pageSize: 50, totalPages: 1 }
    const call = await apiCall<SubscriptionsResponse>(`/api/subscriptions/list?${params.toString()}`, undefined, { fallback })
    if (call.ok && call.result) {
      setRows(call.result.items)
      setTotal(call.result.total)
      setTotalPages(call.result.totalPages)
    } else {
      flash(t('subscriptions.errors.loadFailed', 'Failed to load subscriptions'), 'error')
      setRows([])
    }
    setIsLoading(false)
  }, [filterValues.accessState, filterValues.externalAccountId, filterValues.productCode, page, t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, scopeVersion])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'accessState',
      type: 'select',
      label: t('subscriptions.list.filter.accessState', 'Access state'),
      options: [
        { label: t('subscriptions.list.filter.all', 'All'), value: '' },
        { label: t('subscriptions.accessState.granted', 'Granted'), value: 'granted' },
        { label: t('subscriptions.accessState.grace', 'Grace period'), value: 'grace' },
        { label: t('subscriptions.accessState.pending', 'Pending'), value: 'pending' },
        { label: t('subscriptions.accessState.blocked', 'Blocked'), value: 'blocked' },
      ],
    },
    {
      id: 'productCode',
      type: 'text',
      label: t('subscriptions.list.filter.productCode', 'Product code'),
    },
    {
      id: 'externalAccountId',
      type: 'text',
      label: t('subscriptions.list.filter.externalAccountId', 'External account'),
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<SubscriptionRow>[]>(() => [
    {
      accessorKey: 'externalAccountId',
      header: t('subscriptions.list.columns.externalAccount', 'External account'),
      cell: ({ row }) => (
        <Link className="font-medium underline-offset-2 hover:underline" href={`/backend/subscriptions/${row.original.id}`}>
          {row.original.externalAccountId}
        </Link>
      ),
    },
    {
      accessorKey: 'productCode',
      header: t('subscriptions.list.columns.product', 'Product'),
      cell: ({ row }) => row.original.productCode ?? '—',
    },
    {
      accessorKey: 'planCode',
      header: t('subscriptions.list.columns.plan', 'Plan'),
      cell: ({ row }) => row.original.planCode ?? '—',
    },
    {
      accessorKey: 'accessState',
      header: t('subscriptions.list.columns.accessState', 'Access state'),
      cell: ({ row }) => (
        <Badge variant="secondary" className={ACCESS_STATE_TONE[row.original.accessState] ?? ''}>
          {t(`subscriptions.accessState.${row.original.accessState}`, row.original.accessState)}
        </Badge>
      ),
    },
    {
      accessorKey: 'providerStatus',
      header: t('subscriptions.list.columns.providerStatus', 'Provider status'),
      cell: ({ row }) => row.original.providerStatus,
    },
    {
      accessorKey: 'currentPeriodEnd',
      header: t('subscriptions.list.columns.periodEnd', 'Period end'),
      cell: ({ row }) => row.original.currentPeriodEnd ? new Date(row.original.currentPeriodEnd).toLocaleString() : '—',
    },
    {
      accessorKey: 'updatedAt',
      header: t('subscriptions.list.columns.updatedAt', 'Updated'),
      cell: ({ row }) => row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : '—',
    },
  ], [t])

  return (
    <Page>
      <PageHeader
        title={t('subscriptions.list.title', 'Subscriptions')}
        description={t('subscriptions.list.description', 'Subscription state, billing history, and reconcile diagnostics.')}
      />
      <PageBody className="space-y-6">
        <DataTable
          stickyActionsColumn
          title={t('subscriptions.list.tableTitle', 'Subscriptions')}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
