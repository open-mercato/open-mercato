"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export const RESOURCE = 'financial/payment-methods'
export const CREATE_HREF = '/backend/financial/payment-methods/create'
export const editHref = (id: string) => `/backend/financial/payment-methods/${id}/edit`
export const ENTITY_ID = 'financial:gl_payment_method'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
export const PAYMENT_METHOD_KINDS = ['cash', 'bank_transfer', 'card', 'cheque', 'wallet', 'other'] as const
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number]

export const PAYMENT_METHOD_KIND_FALLBACKS: Record<PaymentMethodKind, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  cheque: 'Cheque',
  wallet: 'Wallet',
  other: 'Other',
}

export type PaymentMethodRow = {
  id: string
  code: string
  name: string
  kind: PaymentMethodKind
  account_id: string
  is_active: boolean
  is_default: boolean
  requires_reference: boolean
  sort_order: number
  updated_at?: string | null
  updatedAt?: string | null
}

/**
 * Both payment screens post to an asset GL account, so the lookup lives here and is
 * shared with the cash-account screen — mirroring how the account form imports its
 * shared constants from the accounts table.
 */
export const ACCOUNTS_RESOURCE = 'financial/accounts'

export type AccountLookupRow = {
  id: string
  code: string
  name: string
}

export function accountLabel(row: AccountLookupRow): string {
  return `${row.code} — ${row.name}`
}

const accountLabelCache = new Map<string, string>()

function cacheAccountLabels(rows: readonly AccountLookupRow[]): void {
  for (const row of rows) accountLabelCache.set(row.id, accountLabel(row))
}

/** The server refuses a payment on a non-asset account, so the picker only offers assets. */
export async function loadAssetAccountOptions(query?: string): Promise<CrudFieldOption[]> {
  const params: Record<string, string | number> = { accountClass: 'asset', pageSize: 100 }
  if (query && query.trim().length > 0) params.search = query.trim()
  const data = await fetchCrudList<AccountLookupRow>(ACCOUNTS_RESOURCE, params)
  const rows = data?.items ?? []
  cacheAccountLabels(rows)
  return rows.map((row) => ({ value: row.id, label: accountLabel(row) }))
}

/** Resolves an already-selected account whose row is not on the loaded page. */
export async function resolveAccountLabel(id: string): Promise<string> {
  const cached = accountLabelCache.get(id)
  if (cached) return cached
  try {
    const data = await fetchCrudList<AccountLookupRow>(ACCOUNTS_RESOURCE, { ids: id, pageSize: 1 })
    const row = data?.items?.[0]
    if (row) {
      const label = accountLabel(row)
      accountLabelCache.set(row.id, label)
      return label
    }
  } catch {
    // Label resolution is best-effort: an unknown account falls back to the raw id.
  }
  return id
}

export default function PaymentMethodsTable() {
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
    queryKey: ['financial-payment-methods', params, scopeVersion],
    queryFn: () => fetchCrudList<PaymentMethodRow>(RESOURCE, params),
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
    queryKey: ['financial-payment-method-accounts', accountIds, scopeVersion],
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

  const columns = React.useMemo<ColumnDef<PaymentMethodRow>[]>(() => [
    {
      accessorKey: 'code',
      header: t('financial.paymentMethods.columns.code', 'Code'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'name',
      header: t('financial.paymentMethods.columns.name', 'Name'),
      meta: { priority: 1, truncate: true, maxWidth: '20rem' },
    },
    {
      accessorKey: 'kind',
      header: t('financial.paymentMethods.columns.kind', 'Kind'),
      cell: ({ getValue }) => {
        const value = getValue() as PaymentMethodKind
        return (
          <Badge variant="secondary">
            {t(`financial.paymentMethods.kind.${value}`, PAYMENT_METHOD_KIND_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
    {
      accessorKey: 'account_id',
      header: t('financial.paymentMethods.columns.account', 'GL account'),
      cell: ({ row }) => (
        <span className="text-sm">{accountLabels.get(row.original.account_id) ?? '—'}</span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '18rem' },
    },
    {
      accessorKey: 'is_default',
      header: t('financial.paymentMethods.columns.default', 'Default'),
      cell: ({ getValue }) => (
        getValue()
          ? <Badge variant="info">{t('financial.paymentMethods.default.yes', 'Default')}</Badge>
          : <span className="text-sm">—</span>
      ),
      meta: { priority: 3 },
    },
    {
      accessorKey: 'is_active',
      header: t('financial.paymentMethods.columns.status', 'Status'),
      cell: ({ getValue }) => (
        <Badge variant={getValue() ? 'success' : 'neutral'}>
          {getValue()
            ? t('financial.paymentMethods.status.active', 'Active')
            : t('financial.paymentMethods.status.inactive', 'Inactive')}
        </Badge>
      ),
      meta: { priority: 4 },
    },
  ], [accountLabels, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('financial.paymentMethods.error.load', 'Failed to load payment methods.')}</div>
  }

  return (
    <DataTable
      title={t('financial.paymentMethods.page.title', 'Payment methods')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('financial.paymentMethods.actions.create', 'New payment method')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('financial.paymentMethods.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('financial.paymentMethods.searchPlaceholder', 'Code or name')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'kind',
          label: t('financial.paymentMethods.filters.kind', 'Kind'),
          type: 'select',
          options: PAYMENT_METHOD_KINDS.map((value) => ({
            value,
            label: t(`financial.paymentMethods.kind.${value}`, PAYMENT_METHOD_KIND_FALLBACKS[value]),
          })),
        },
        {
          id: 'isActive',
          label: t('financial.paymentMethods.filters.status', 'Status'),
          type: 'select',
          options: [
            { value: 'true', label: t('financial.paymentMethods.status.active', 'Active') },
            { value: 'false', label: t('financial.paymentMethods.status.inactive', 'Inactive') },
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
