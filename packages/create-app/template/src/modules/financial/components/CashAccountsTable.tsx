"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ACCOUNTS_RESOURCE, accountLabel, type AccountLookupRow } from './PaymentMethodsTable'

export const RESOURCE = 'financial/cash-accounts'
export const CREATE_HREF = '/backend/financial/cash-accounts/create'
export const editHref = (id: string) => `/backend/financial/cash-accounts/${id}/edit`
export const ENTITY_ID = 'financial:gl_cash_account'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
export const CASH_ACCOUNT_KINDS = ['cash', 'bank'] as const
export type CashAccountKind = (typeof CASH_ACCOUNT_KINDS)[number]

export const CASH_ACCOUNT_KIND_FALLBACKS: Record<CashAccountKind, string> = {
  cash: 'Cash',
  bank: 'Bank',
}

export type CashAccountRow = {
  id: string
  code: string
  name: string
  kind: CashAccountKind
  account_id: string
  currency_code: string
  bank_name?: string | null
  iban?: string | null
  account_number?: string | null
  is_active: boolean
  is_default: boolean
  updated_at?: string | null
  updatedAt?: string | null
}

export default function CashAccountsTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [values, setValues] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'code', desc: false }])
  const [page, setPage] = React.useState(1)

  const kind = typeof values.kind === 'string' ? values.kind : undefined
  const isActive = typeof values.isActive === 'string' ? values.isActive : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'code',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (kind) out.kind = kind
    if (isActive) out.isActive = isActive
    return out
  }, [isActive, kind, page, search, sorting])

  const query = useQuery({
    queryKey: ['financial-cash-accounts', params, scopeVersion],
    queryFn: () => fetchCrudList<CashAccountRow>(RESOURCE, params),
  })

  const data = query.data

  const accountIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const item of data?.items ?? []) {
      if (typeof item.account_id === 'string' && item.account_id.length > 0) ids.add(item.account_id)
    }
    return Array.from(ids).sort()
  }, [data])

  const accountsQuery = useQuery({
    queryKey: ['financial-cash-account-accounts', accountIds, scopeVersion],
    enabled: accountIds.length > 0,
    queryFn: () => fetchCrudList<AccountLookupRow>(ACCOUNTS_RESOURCE, { ids: accountIds, pageSize: 100 }),
  })

  const accountLabels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const account of accountsQuery.data?.items ?? []) {
      map.set(account.id, accountLabel(account))
    }
    return map
  }, [accountsQuery.data])

  const columns = React.useMemo<ColumnDef<CashAccountRow>[]>(() => [
    {
      accessorKey: 'code',
      header: t('financial.cashAccounts.columns.code', 'Code'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'name',
      header: t('financial.cashAccounts.columns.name', 'Name'),
      meta: { priority: 1, truncate: true, maxWidth: '20rem' },
    },
    {
      accessorKey: 'kind',
      header: t('financial.cashAccounts.columns.kind', 'Kind'),
      cell: ({ getValue }) => {
        const value = getValue() as CashAccountKind
        return (
          <Badge variant="secondary">
            {t(`financial.cashAccounts.kind.${value}`, CASH_ACCOUNT_KIND_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
    {
      accessorKey: 'account_id',
      header: t('financial.cashAccounts.columns.account', 'GL account'),
      cell: ({ row }) => (
        <span className="text-sm">{accountLabels.get(row.original.account_id) ?? '—'}</span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '18rem' },
    },
    {
      accessorKey: 'currency_code',
      header: t('financial.cashAccounts.columns.currency', 'Currency'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'iban',
      header: t('financial.cashAccounts.columns.iban', 'IBAN'),
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">
          {typeof getValue() === 'string' && getValue() ? String(getValue()) : '—'}
        </span>
      ),
      meta: { priority: 4 },
    },
    {
      accessorKey: 'is_default',
      header: t('financial.cashAccounts.columns.default', 'Default'),
      cell: ({ getValue }) => (
        getValue()
          ? <Badge variant="info">{t('financial.cashAccounts.default.yes', 'Default')}</Badge>
          : <span className="text-sm">—</span>
      ),
      meta: { priority: 3 },
    },
    {
      accessorKey: 'is_active',
      header: t('financial.cashAccounts.columns.status', 'Status'),
      cell: ({ getValue }) => (
        <Badge variant={getValue() ? 'success' : 'neutral'}>
          {getValue()
            ? t('financial.cashAccounts.status.active', 'Active')
            : t('financial.cashAccounts.status.inactive', 'Inactive')}
        </Badge>
      ),
      meta: { priority: 4 },
    },
  ], [accountLabels, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('financial.cashAccounts.error.load', 'Failed to load cash accounts.')}</div>
  }

  return (
    <DataTable
      title={t('financial.cashAccounts.page.title', 'Cash and bank accounts')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('financial.cashAccounts.actions.create', 'New account')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('financial.cashAccounts.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('financial.cashAccounts.searchPlaceholder', 'Code, name or bank')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'kind',
          label: t('financial.cashAccounts.filters.kind', 'Kind'),
          type: 'select',
          options: CASH_ACCOUNT_KINDS.map((value) => ({
            value,
            label: t(`financial.cashAccounts.kind.${value}`, CASH_ACCOUNT_KIND_FALLBACKS[value]),
          })),
        },
        {
          id: 'isActive',
          label: t('financial.cashAccounts.filters.status', 'Status'),
          type: 'select',
          options: [
            { value: 'true', label: t('financial.cashAccounts.status.active', 'Active') },
            { value: 'false', label: t('financial.cashAccounts.status.inactive', 'Inactive') },
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
  )
}
