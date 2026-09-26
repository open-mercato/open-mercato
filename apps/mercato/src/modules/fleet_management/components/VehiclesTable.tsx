"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type VehicleRow = {
  id: string
  plate_number: string
  sequence_number?: string | null
  make: string
  model: string
  year: number
  color?: string | null
  vehicle_type?: string | null
  status: 'active' | 'assigned' | 'maintenance' | 'out_of_service'
  current_odometer: number
  assigned_employee_id?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_FALLBACKS: Record<VehicleRow['status'], string> = {
  active: 'Active',
  assigned: 'In custody',
  maintenance: 'Maintenance',
  out_of_service: 'Out of service',
}

const STATUS_VALUES: VehicleRow['status'][] = ['active', 'assigned', 'maintenance', 'out_of_service']

export default function VehiclesTable() {
  const t = useT()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'plate_number', desc: false }])
  const [page, setPage] = React.useState(1)
  const scopeVersion = useOrganizationScopeVersion()

  const statusFilter = typeof values.status === 'string' ? values.status : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'plate_number',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.plateNumber = search.trim()
    if (statusFilter) out.status = statusFilter
    return out
  }, [page, sorting, search, statusFilter])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['fleet-vehicles', params, scopeVersion],
    queryFn: () => fetchCrudList<VehicleRow>('fleet_management/vehicles', params),
  })

  const columns = React.useMemo<ColumnDef<VehicleRow>[]>(
    () => [
      {
        accessorKey: 'plate_number',
        header: t('fleet_management.vehicles.columns.plate', 'Plate number'),
        meta: { priority: 1 },
      },
      {
        id: 'vehicle',
        header: t('fleet_management.vehicles.columns.vehicle', 'Vehicle'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{`${row.original.make} ${row.original.model}`}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[row.original.color, row.original.vehicle_type].filter(Boolean).join(' · ') || '—'}
            </span>
          </span>
        ),
        meta: { priority: 2 },
      },
      {
        accessorKey: 'year',
        header: t('fleet_management.vehicles.columns.year', 'Year'),
        meta: { priority: 4 },
      },
      {
        accessorKey: 'status',
        header: t('fleet_management.vehicles.columns.status', 'Status'),
        cell: ({ getValue }) => {
          const value = getValue() as VehicleRow['status']
          return (
            <Badge variant="secondary">
              {t(`fleet_management.vehicles.status.${value}`, STATUS_FALLBACKS[value] ?? value)}
            </Badge>
          )
        },
        meta: { priority: 3 },
      },
      {
        accessorKey: 'current_odometer',
        header: t('fleet_management.vehicles.columns.odometer', 'Odometer'),
        cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() ?? 0).toLocaleString()}</span>,
        meta: { priority: 5 },
      },
      {
        accessorKey: 'assigned_employee_id',
        header: t('fleet_management.vehicles.columns.custody', 'Custody'),
        enableSorting: false,
        cell: ({ getValue }) => {
          const value = getValue()
          if (typeof value !== 'string' || value.length === 0) {
            return <span className="text-xs text-muted-foreground">{t('fleet_management.vehicles.custody.none', 'Nobody')}</span>
          }
          return <span className="font-mono text-xs">{`${value.slice(0, 8)}…`}</span>
        },
        meta: { priority: 6 },
      },
    ],
    [t],
  )

  if (isError) {
    return (
      <div className="text-sm text-destructive">
        {t('fleet_management.vehicles.error.load', 'Failed to load vehicles.')}
      </div>
    )
  }

  return (
    <DataTable
      title={t('fleet_management.vehicles.page.title', 'Vehicles')}
      titleHeadingLevel={1}
      columns={columns}
      data={data?.items ?? []}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      // `searchAlign` only takes physical sides, so the inline end is expressed here:
      // the search box belongs at the reading end of the toolbar in both scripts.
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'status',
          label: t('fleet_management.vehicles.filters.status', 'Status'),
          type: 'select',
          options: STATUS_VALUES.map((value) => ({
            value,
            label: t(`fleet_management.vehicles.status.${value}`, STATUS_FALLBACKS[value]),
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
      entityId="fleet_management:fleet_vehicle"
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
      isLoading={isLoading}
    />
  )
}