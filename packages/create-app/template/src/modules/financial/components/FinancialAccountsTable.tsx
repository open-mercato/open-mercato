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

export const RESOURCE = 'financial/accounts'
export const CREATE_HREF = '/backend/financial/accounts/create'
export const editHref = (id: string) => `/backend/financial/accounts/${id}/edit`
export const ENTITY_ID = 'financial:gl_account'

export type AccountClass = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type NormalBalance = 'debit' | 'credit'

export const ACCOUNT_CLASS_VALUES: AccountClass[] = ['asset', 'liability', 'equity', 'revenue', 'expense']
export const NORMAL_BALANCE_VALUES: NormalBalance[] = ['debit', 'credit']

export const ACCOUNT_CLASS_FALLBACKS: Record<AccountClass, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expense',
}

export const NORMAL_BALANCE_FALLBACKS: Record<NormalBalance, string> = {
  debit: 'Debit',
  credit: 'Credit',
}

export type AccountRow = {
  id: string
  code: string
  name: string
  description?: string | null
  account_class: AccountClass
  account_type?: string | null
  currency_code: string
  normal_balance: NormalBalance
  is_active: boolean
  is_reconciliation_required: boolean
  country_code?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

export default function FinancialAccountsTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [values, setValues] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'code', desc: false }])
  const [page, setPage] = React.useState(1)

  const accountClass = typeof values.accountClass === 'string' ? values.accountClass : undefined
  const isActive = typeof values.isActive === 'string' ? values.isActive : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'code',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (accountClass) out.accountClass = accountClass
    if (isActive) out.isActive = isActive
    return out
  }, [accountClass, isActive, page, search, sorting])

  const query = useQuery({
    queryKey: ['financial-accounts', params, scopeVersion],
    queryFn: () => fetchCrudList<AccountRow>(RESOURCE, params),
  })

  const data = query.data

  const columns = React.useMemo<ColumnDef<AccountRow>[]>(() => [
    {
      accessorKey: 'code',
      header: t('financial.accounts.columns.code', 'Code'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'name',
      header: t('financial.accounts.columns.name', 'Account'),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'account_class',
      header: t('financial.accounts.columns.class', 'Class'),
      cell: ({ getValue }) => {
        const value = getValue() as AccountClass
        return (
          <Badge variant="secondary">
            {t(`financial.accounts.class.${value}`, ACCOUNT_CLASS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
    {
      accessorKey: 'normal_balance',
      header: t('financial.accounts.columns.normalBalance', 'Normal balance'),
      cell: ({ getValue }) => {
        const value = getValue() as NormalBalance
        return (
          <span className="text-sm">
            {t(`financial.accounts.normalBalance.${value}`, NORMAL_BALANCE_FALLBACKS[value] ?? value)}
          </span>
        )
      },
      meta: { priority: 3 },
    },
    {
      accessorKey: 'currency_code',
      header: t('financial.accounts.columns.currency', 'Currency'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'is_active',
      header: t('financial.accounts.columns.status', 'Status'),
      cell: ({ getValue }) => (
        <span className="text-sm">
          {getValue()
            ? t('financial.accounts.status.active', 'Active')
            : t('financial.accounts.status.inactive', 'Inactive')}
        </span>
      ),
      meta: { priority: 4 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('financial.accounts.error.load', 'Failed to load accounts.')}</div>
  }

  return (
    <DataTable
      title={t('financial.accounts.page.title', 'Chart of accounts')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('financial.accounts.actions.create', 'New account')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('financial.accounts.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('financial.accounts.searchPlaceholder', 'Code or name')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'accountClass',
          label: t('financial.accounts.filters.class', 'Class'),
          type: 'select',
          options: ACCOUNT_CLASS_VALUES.map((value) => ({
            value,
            label: t(`financial.accounts.class.${value}`, ACCOUNT_CLASS_FALLBACKS[value]),
          })),
        },
        {
          id: 'isActive',
          label: t('financial.accounts.filters.status', 'Status'),
          type: 'select',
          options: [
            { value: 'true', label: t('financial.accounts.status.active', 'Active') },
            { value: 'false', label: t('financial.accounts.status.inactive', 'Inactive') },
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

