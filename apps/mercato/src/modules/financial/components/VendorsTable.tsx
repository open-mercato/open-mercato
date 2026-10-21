'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'

const RESOURCE = 'financial/ap/vendors'
const CREATE_HREF = '/backend/financial/payables/vendors/create'
const editHref = (id: string) => `/backend/financial/payables/vendors/${id}/edit`

export type VendorRow = {
  id: string
  code: string
  name: string
  name_ar?: string | null
  vat_number?: string | null
  cr_number?: string | null
  email?: string | null
  phone?: string | null
  country_code?: string | null
  is_active?: boolean | null
  updated_at?: string | null
  updatedAt?: string | null
}

export default function VendorsTable() {
  const t = useT()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const query = useQuery({
    queryKey: ['financial-ap-vendors', search, page],
    queryFn: () => fetchCrudList<VendorRow>(RESOURCE, {
      page,
      pageSize: 50,
      ...(search.trim() ? { search: search.trim() } : {}),
      sortField: 'name',
      sortDir: 'asc',
    }),
  })
  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<VendorRow>[]>(() => [
    { accessorKey: 'code', header: t('financial.ap.vendors.columns.code', 'Code'), cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '')}</span> },
    { accessorKey: 'name', header: t('financial.ap.vendors.columns.name', 'Vendor') },
    { accessorKey: 'vat_number', header: t('financial.ap.vendors.columns.vatNumber', 'VAT number'), cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string | null) ?? '—'}</span> },
    { accessorKey: 'cr_number', header: t('financial.ap.vendors.columns.crNumber', 'CR number'), cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string | null) ?? '—'}</span> },
    {
      accessorKey: 'is_active',
      header: t('financial.ap.vendors.columns.status', 'Status'),
      cell: ({ getValue }) => (getValue() === false
        ? <Badge variant="secondary">{t('financial.ap.vendors.status.inactive', 'Inactive')}</Badge>
        : <Badge>{t('financial.ap.vendors.status.active', 'Active')}</Badge>),
    },
  ], [t])

  if (query.isError) {
    return <p className="text-sm text-destructive">{t('financial.ap.vendors.error.load', 'Could not load vendors.')}</p>
  }

  return (
    <DataTable
      title={t('financial.ap.vendors.page.title', 'Vendors')}
      titleHeadingLevel={1}
      actions={<Button asChild><Link href={CREATE_HREF}>{t('financial.ap.vendors.actions.create', 'New vendor')}</Link></Button>}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('financial.ap.vendors.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => { setSearch(value); setPage(1) }}
      searchPlaceholder={t('financial.ap.vendors.searchPlaceholder', 'Code, name or VAT number')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      entityId="financial:ap_vendor"
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
