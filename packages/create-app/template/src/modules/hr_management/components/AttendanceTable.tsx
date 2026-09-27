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
import type { AttendanceStatus } from '../data/entities'
import { useEmployeeLabels } from './hrOptions'

const RESOURCE = 'hr_management/attendance'
const LIST_HREF = '/backend/hr/attendance'
const CREATE_HREF = '/backend/hr/attendance/create'
const editHref = (id: string) => `/backend/hr/attendance/${id}/edit`

// Mirrors ATTENDANCE_STATUSES in data/entities.ts; the API rejects an unknown value, so a
// drift fails loudly rather than silently storing a status nothing recognises.
const STATUS_VALUES: AttendanceStatus[] = ['present', 'absent', 'late', 'on_leave', 'holiday']

const STATUS_FALLBACKS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On leave',
  holiday: 'Holiday',
}

export type AttendanceRow = {
  id: string
  employee_id: string
  date: string
  check_in_at?: string | null
  check_out_at?: string | null
  status: AttendanceStatus
  worked_minutes?: number | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

/** Renders an instant as the wall-clock time of the calendar day it belongs to. */
export function toClockTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toISOString().slice(11, 16)
}

/** Minutes as `8h 30m`, which is how attendance is read and corrected. */
export function formatWorkedMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes < 0) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

export default function AttendanceTable() {
  const t = useT()
  const direction = useDirection()
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'date', desc: true }])
  const [page, setPage] = React.useState(1)
  const scopeVersion = useOrganizationScopeVersion()
  const { employees, labels } = useEmployeeLabels()

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const employeeFilter = typeof values.employeeId === 'string' ? values.employeeId : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'date',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    if (employeeFilter) out.employeeId = employeeFilter
    return out
  }, [page, sorting, statusFilter, employeeFilter])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hr-attendance', params, scopeVersion],
    queryFn: () => fetchCrudList<AttendanceRow>(RESOURCE, params),
  })

  const columns = React.useMemo<ColumnDef<AttendanceRow>[]>(() => [
    {
      id: 'employee',
      header: t('hr_management.attendance.columns.employee', 'Employee'),
      cell: ({ row }) => labels.get(row.original.employee_id) ?? '—',
      meta: { priority: 1 },
    },
    {
      accessorKey: 'date',
      header: t('hr_management.attendance.columns.date', 'Date'),
      cell: ({ row }) => (row.original.date ? String(row.original.date).slice(0, 10) : '—'),
      meta: { priority: 1 },
    },
    {
      id: 'checkIn',
      header: t('hr_management.attendance.columns.checkIn', 'Check in'),
      cell: ({ row }) => toClockTime(row.original.check_in_at),
    },
    {
      id: 'checkOut',
      header: t('hr_management.attendance.columns.checkOut', 'Check out'),
      cell: ({ row }) => toClockTime(row.original.check_out_at),
    },
    {
      id: 'worked',
      header: t('hr_management.attendance.columns.worked', 'Worked'),
      cell: ({ row }) => formatWorkedMinutes(row.original.worked_minutes),
    },
    {
      accessorKey: 'status',
      header: t('hr_management.attendance.columns.status', 'Status'),
      cell: ({ row }) => (
        <Badge>{t(`hr_management.attendance.status.${row.original.status}`, STATUS_FALLBACKS[row.original.status])}</Badge>
      ),
    },
  ], [t, labels])

  if (isError) {
    return <div className="text-sm text-destructive">{t('hr_management.attendance.error.load', 'Could not load attendance records.')}</div>
  }

  return (
    <DataTable
      title={t('hr_management.attendance.page.title', 'Attendance')}
      titleHeadingLevel={1}
      actions={(
        <Button asChild>
          <Link href={CREATE_HREF}>{t('hr_management.attendance.actions.create', 'New attendance record')}</Link>
        </Button>
      )}
      rowActions={(row) => (
        <Link className="text-sm font-medium underline" href={editHref(row.id)}>
          {t('hr_management.attendance.actions.edit', 'Edit')}
        </Link>
      )}
      columns={columns}
      data={data?.items ?? []}
      // No search box: the attendance endpoint filters by employee, status and id only, so a
      // free-text field would have nothing to search.
      searchAlign={direction === 'rtl' ? 'left' : 'right'}
      filters={[
        {
          id: 'employeeId',
          label: t('hr_management.attendance.filters.employee', 'Employee'),
          type: 'select',
          options: employees.map((employee) => ({
            value: employee.id,
            label: `${employee.first_name} ${employee.last_name}`.trim(),
          })),
        },
        {
          id: 'status',
          label: t('hr_management.attendance.filters.status', 'Status'),
          type: 'select',
          options: STATUS_VALUES.map((value) => ({
            value,
            label: t(`hr_management.attendance.status.${value}`, STATUS_FALLBACKS[value]),
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
      entityId="hr_management:hr_attendance_record"
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

