"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { ExpiryCell } from './ExpiryCell'
import { useEmployeeLabels } from './hrOptions'

const RESOURCE = 'hr_management/driver-profiles'
const CREATE_HREF = '/backend/hr/drivers/create'
const editHref = (id: string) => `/backend/hr/drivers/${id}/edit`

export type DriverRow = {
  id: string
  employee_id?: string | null
  license_number?: string | null
  license_type?: string | null
  license_expiry?: string | null
  medical_check_expiry?: string | null
  years_of_experience?: number | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

export default function DriversTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  // Expiry first: the driver directory exists to catch renewals before they lapse.
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'licenseExpiry', desc: false }])
  const [page, setPage] = React.useState(1)

  const { labels: employeeLabels, employees } = useEmployeeLabels()
  const expiryFilter = typeof values.expiry === 'string' ? values.expiry : undefined
  const employeeFilter = typeof values.employeeId === 'string' ? values.employeeId : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'licenseExpiry',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (expiryFilter) out.expiry = expiryFilter
    if (employeeFilter) out.employeeId = employeeFilter
    return out
  }, [page, sorting, search, expiryFilter, employeeFilter])

  const query = useQuery({
    queryKey: ['hr-drivers', params, scopeVersion],
    queryFn: () => fetchCrudList<DriverRow>(RESOURCE, params),
  })

  const data = query.data
  const rows = data?.items ?? []

  const columns = React.useMemo<ColumnDef<DriverRow>[]>(() => [
    {
      id: 'driver',
      header: t('hr_management.drivers.columns.driver', 'Driver'),
      cell: ({ row }) => {
        const employeeId = row.original.employee_id
        if (!employeeId) return <span className="text-xs text-muted-foreground">—</span>
        return <span className="text-sm font-medium">{employeeLabels.get(employeeId) ?? '—'}</span>
      },
      meta: { priority: 1 },
    },
    {
      id: 'license',
      header: t('hr_management.drivers.columns.license', 'Licence'),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs">{row.original.license_number || '—'}</span>
          {row.original.license_type ? (
            <span className="text-xs text-muted-foreground">{row.original.license_type}</span>
          ) : null}
        </div>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'license_expiry',
      header: t('hr_management.drivers.columns.licenseExpiry', 'Licence expiry'),
      cell: ({ row }) => <ExpiryCell value={row.original.license_expiry} />,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'medical_check_expiry',
      header: t('hr_management.drivers.columns.medicalExpiry', 'Medical check'),
      cell: ({ row }) => <ExpiryCell value={row.original.medical_check_expiry} />,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'years_of_experience',
      header: t('hr_management.drivers.columns.experience', 'Experience (years)'),
      cell: ({ getValue }) => {
        const value = getValue() as number | null
        // Count-free copy: `useT` has no plural forms, so the unit lives in the header.
        return value === null || value === undefined
          ? <span className="text-xs text-muted-foreground">—</span>
          : <span className="text-sm">{String(value)}</span>
      },
      meta: { priority: 3 },
    },
  ], [t, employeeLabels])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.drivers.error.load', 'Could not load drivers.')}</div>
  }

  return (
    <DataTable
      title={t('hr_management.drivers.page.title', 'Drivers')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('hr_management.drivers.actions.create', 'New driver profile')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('hr_management.drivers.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      searchPlaceholder={t('hr_management.drivers.searchPlaceholder', 'Licence number or type')}
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'expiry',
          label: t('hr_management.drivers.filters.expiry', 'Compliance'),
          type: 'select',
          options: [
            { value: 'expired', label: t('hr_management.drivers.filters.expired', 'Expired') },
            { value: 'within30', label: t('hr_management.drivers.filters.within30', 'Expired or due within 30 days') },
          ],
        },
        {
          id: 'employeeId',
          label: t('hr_management.drivers.filters.employee', 'Driver'),
          type: 'select',
          options: employees.map((employee) => ({
            value: employee.id,
            label: `${employee.first_name} ${employee.last_name}`.trim(),
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
      entityId="hr_management:hr_driver_profile"
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
