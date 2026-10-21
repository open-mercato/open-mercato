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
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

// `import type` only: a value import of the entities module would pull MikroORM
// decorators into the browser bundle.
import type { EmployeeStatus, EmploymentType } from '../data/entities'
import { useDepartmentOptions } from './hrOptions'

const RESOURCE = 'hr_management/employees'
const LIST_HREF = '/backend/hr/employees'
const CREATE_HREF = '/backend/hr/employees/create'
const editHref = (id: string) => `/backend/hr/employees/${id}/edit`

// Mirrors EMPLOYEE_STATUSES in data/entities.ts. Duplicated as a literal because the
// module that declares it is server-only, and a drift here fails loudly (the API
// rejects an unknown status) rather than silently.
const STATUS_VALUES: EmployeeStatus[] = ['active', 'on_leave', 'suspended', 'terminated']

const STATUS_FALLBACKS: Record<EmployeeStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  suspended: 'Suspended',
  terminated: 'Terminated',
}

export type EmployeeRow = {
  id: string
  employee_number: string
  first_name: string
  last_name: string
  identity_type?: 'national_id' | 'iqama' | null
  national_id?: string | null
  national_id_expiry?: string | null
  department_id?: string | null
  manager_employee_id?: string | null
  job_title: string
  employment_type?: EmploymentType | null
  status: EmployeeStatus
  hire_date: string
  termination_date?: string | null
  email?: string | null
  phone?: string | null
  bank_iban?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type DepartmentRow = {
  id: string
  name: string
}

export { useDepartmentOptions } from './hrOptions'

export function employeeName(row: Pick<EmployeeRow, 'first_name' | 'last_name'>): string {
  return `${row.first_name} ${row.last_name}`.trim()
}

export default function EmployeesTable() {
  const t = useT()
  const direction = useDirection()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'employee_number', desc: false }])
  const [page, setPage] = React.useState(1)
  const scopeVersion = useOrganizationScopeVersion()
  const { departments, labels } = useDepartmentOptions()

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const departmentFilter = typeof values.departmentId === 'string' ? values.departmentId : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'employee_number',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim().length > 0) out.search = search.trim()
    if (statusFilter) out.status = statusFilter
    if (departmentFilter) out.departmentId = departmentFilter
    return out
  }, [page, sorting, search, statusFilter, departmentFilter])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hr-employees', params, scopeVersion],
    queryFn: () => fetchCrudList<EmployeeRow>(RESOURCE, params),
  })

  const columns = React.useMemo<ColumnDef<EmployeeRow>[]>(() => [
    {
      accessorKey: 'employee_number',
      header: t('hr_management.employees.columns.number', 'Employee no.'),
      meta: { priority: 1 },
    },
    {
      id: 'name',
      header: t('hr_management.employees.columns.name', 'Name'),
      cell: ({ row }) => employeeName(row.original),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'job_title',
      header: t('hr_management.employees.columns.jobTitle', 'Job title'),
    },
    {
      id: 'department',
      header: t('hr_management.employees.columns.department', 'Department'),
      cell: ({ row }) => {
        const departmentId = row.original.department_id
        if (!departmentId) return '—'
        return labels.get(departmentId) ?? '—'
      },
    },
    {
      accessorKey: 'status',
      header: t('hr_management.employees.columns.status', 'Status'),
      cell: ({ row }) => (
        <Badge>{t(`hr_management.employees.status.${row.original.status}`, STATUS_FALLBACKS[row.original.status])}</Badge>
      ),
    },
    {
      accessorKey: 'hire_date',
      header: t('hr_management.employees.columns.hireDate', 'Hire date'),
    },
  ], [t, labels])

  if (isError) {
    return <div className="text-sm text-destructive">{t('hr_management.employees.error.load', 'Could not load employees.')}</div>
  }

  return (
    <DataTable
      title={t('hr_management.employees.page.title', 'Employees')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('hr_management.employees.actions.create', 'New employee')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('hr_management.employees.actions.edit', 'Edit')}
        </Link>
      )}
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
          label: t('hr_management.employees.filters.status', 'Status'),
          type: 'select',
          options: STATUS_VALUES.map((value) => ({
            value,
            label: t(`hr_management.employees.status.${value}`, STATUS_FALLBACKS[value]),
          })),
        },
        {
          id: 'departmentId',
          label: t('hr_management.employees.filters.department', 'Department'),
          type: 'select',
          options: departments.map((department) => ({ value: department.id, label: department.name })),
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
      entityId="hr_management:hr_employee"
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

