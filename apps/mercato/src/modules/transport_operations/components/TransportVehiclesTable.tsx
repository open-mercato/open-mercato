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

export const RESOURCE = 'transport_operations/vehicles'
export const CREATE_HREF = '/backend/transport/vehicles/create'
export const editHref = (id: string) => `/backend/transport/vehicles/${id}/edit`
export const ENTITY_ID = 'transport_operations:transport_vehicle'

export type VehicleStatus = 'active' | 'maintenance' | 'out_of_service'

export const VEHICLE_STATUS_VALUES: VehicleStatus[] = ['active', 'maintenance', 'out_of_service']

export type VehicleRow = {
  id: string
  plate_number: string
  vin?: string | null
  sequence_number?: string | null
  make: string
  model: string
  year: number
  capacity: number
  color?: string | null
  vehicle_type?: string | null
  current_odometer?: number | null
  notes?: string | null
  status: VehicleStatus
  telematics_device_id?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_FALLBACKS: Record<VehicleStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  out_of_service: 'Out of service',
}

export default function TransportVehiclesTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'plate_number', desc: false }])
  const [page, setPage] = React.useState(1)

  const statusFilter = typeof values.status === 'string' ? values.status : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'plate_number',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (statusFilter) out.status = statusFilter
    return out
  }, [page, sorting, search, statusFilter])

  const query = useQuery({
    queryKey: ['transport-vehicles', params, scopeVersion],
    queryFn: () => fetchCrudList<VehicleRow>(RESOURCE, params),
  })

  const data = query.data

  const columns = React.useMemo<ColumnDef<VehicleRow>[]>(() => [
    {
      accessorKey: 'plate_number',
      header: t('transport_operations.vehicles.columns.plate', 'Plate number'),
      meta: { priority: 1 },
    },
    {
      id: 'vehicle',
      header: t('transport_operations.vehicles.columns.vehicle', 'Vehicle'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{`${row.original.make} ${row.original.model}`}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{row.original.vin || '—'}</span>
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'year',
      header: t('transport_operations.vehicles.columns.year', 'Year'),
      cell: ({ getValue }) => <span className="tabular-nums text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'capacity',
      header: t('transport_operations.vehicles.columns.capacity', 'Seats'),
      cell: ({ getValue }) => <span className="tabular-nums text-sm">{String(getValue() ?? '—')}</span>,
      meta: { priority: 5 },
    },
    {
      accessorKey: 'status',
      header: t('transport_operations.vehicles.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as VehicleStatus
        return (
          <Badge variant="secondary">
            {t(`transport_operations.vehicles.status.${value}`, STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 3 },
    },
  ], [t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('transport_operations.vehicles.error.load', 'Failed to load vehicles.')}</div>
  }

  return (
    <DataTable
      title={t('transport_operations.vehicles.page.title', 'Vehicles')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('transport_operations.vehicles.actions.create', 'New vehicle')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('transport_operations.vehicles.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('transport_operations.vehicles.searchPlaceholder', 'Plate, VIN, make or model')}
      // `searchAlign` only takes physical sides, so the inline end is expressed here:
      // the search box belongs at the reading end of the toolbar in both scripts.
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'status',
          label: t('transport_operations.vehicles.filters.status', 'Status'),
          type: 'select',
          options: VEHICLE_STATUS_VALUES.map((value) => ({
            value,
            label: t(`transport_operations.vehicles.status.${value}`, STATUS_FALLBACKS[value]),
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
