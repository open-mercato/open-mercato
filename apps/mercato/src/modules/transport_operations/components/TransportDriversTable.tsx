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
import { ExpiryCell } from './ExpiryCell'

export const RESOURCE = 'transport_operations/drivers'
export const CREATE_HREF = '/backend/transport/drivers/create'
export const editHref = (id: string) => `/backend/transport/drivers/${id}/edit`
export const ENTITY_ID = 'transport_operations:transport_driver'

export type DriverStatus = 'available' | 'on_trip' | 'on_leave' | 'suspended'

export const DRIVER_STATUS_VALUES: DriverStatus[] = ['available', 'on_trip', 'on_leave', 'suspended']

export type DriverRow = {
  user_id?: string | null
  id: string
  employee_id?: string | null
  full_name: string
  national_id: string
  license_number: string
  license_expiry: string
  phone: string
  status: DriverStatus
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_FALLBACKS: Record<DriverStatus, string> = {
  available: 'Available',
  on_trip: 'On a trip',
  on_leave: 'On leave',
  suspended: 'Suspended',
}

export default function TransportDriversTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  // Expiry first: the driver directory exists to catch renewals before dispatch refuses the trip.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'license_expiry', desc: false }])
  const [page, setPage] = React.useState(1)

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const expiryFilter = typeof values.expiry === 'string' ? values.expiry : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'license_expiry',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (statusFilter) out.status = statusFilter
    if (expiryFilter) out.expiry = expiryFilter
    return out
  }, [page, sorting, search, statusFilter, expiryFilter])

  const query = useQuery({
    queryKey: ['transport-drivers', params, scopeVersion],
    queryFn: () => fetchCrudList<DriverRow>(RESOURCE, params),
  })

  const data = query.data

  const columns = React.useMemo<ColumnDef<DriverRow>[]>(() => [
    {
      id: 'driver',
      header: t('transport_operations.drivers.columns.driver', 'Driver'),
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.full_name || '—'}</span>
          <span className="truncate text-xs text-muted-foreground">{row.original.phone || '—'}</span>
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'national_id',
      header: t('transport_operations.drivers.columns.nationalId', 'National id'),
      cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span>,
      meta: { priority: 4 },
    },
    {
      id: 'license',
      header: t('transport_operations.drivers.columns.license', 'Licence'),
      enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.license_number || '—'}</span>,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'license_expiry',
      header: t('transport_operations.drivers.columns.licenseExpiry', 'Licence expiry'),
      cell: ({ row }) => <ExpiryCell value={row.original.license_expiry} />,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('transport_operations.drivers.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as DriverStatus
        return (
          <Badge variant="secondary">
            {t(`transport_operations.drivers.status.${value}`, STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 3 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('transport_operations.drivers.error.load', 'Failed to load drivers.')}</div>
  }

  return (
    <DataTable
      title={t('transport_operations.drivers.page.title', 'Drivers')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('transport_operations.drivers.actions.create', 'New driver')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('transport_operations.drivers.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('transport_operations.drivers.searchPlaceholder', 'Name, national id, licence or phone')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'expiry',
          label: t('transport_operations.drivers.filters.compliance', 'Compliance'),
          type: 'select',
          options: [
            { value: 'expired', label: t('transport_operations.drivers.filters.expired', 'Expired') },
            { value: 'within30', label: t('transport_operations.drivers.filters.within30', 'Expired or due within 30 days') },
          ],
        },
        {
          id: 'status',
          label: t('transport_operations.drivers.filters.status', 'Status'),
          type: 'select',
          options: DRIVER_STATUS_VALUES.map((value) => ({
            value,
            label: t(`transport_operations.drivers.status.${value}`, STATUS_FALLBACKS[value]),
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
  )
}
