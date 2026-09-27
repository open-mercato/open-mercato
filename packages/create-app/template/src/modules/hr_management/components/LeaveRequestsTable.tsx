"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

// `import type` only: a value import of the entities module would pull MikroORM
// decorators into the browser bundle.
import type { LeaveRequestStatus, LeaveType } from '../data/entities'
import { useEmployeeLabels } from './hrOptions'

const RESOURCE = 'hr_management/leave-requests'
const LIST_HREF = '/backend/hr/leave-requests'
const CREATE_HREF = '/backend/hr/leave-requests/create'
const editHref = (id: string) => `/backend/hr/leave-requests/${id}/edit`

// Mirrors the enums in data/entities.ts; a drift fails loudly because the API rejects an
// unknown value rather than silently accepting it.
const LEAVE_TYPE_VALUES: LeaveType[] = ['annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other']
const STATUS_VALUES: LeaveRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled']

const TYPE_FALLBACKS: Record<LeaveType, string> = {
  annual: 'Annual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  emergency: 'Emergency',
  maternity: 'Maternity',
  other: 'Other',
}

const STATUS_FALLBACKS: Record<LeaveRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export type LeaveRequestRow = {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  total_days?: number | null
  reason?: string | null
  status: LeaveRequestStatus
  approval_request_id?: string | null
  decided_at?: string | null
  decision_comment?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type EmployeeOption = { id: string; first_name: string; last_name: string; employee_number?: string | null }

export { useEmployeeLabels } from './hrOptions'

export default function LeaveRequestsTable() {
  const t = useT()
  const direction = useDirection()
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'start_date', desc: true }])
  const [page, setPage] = React.useState(1)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const scopeVersion = useOrganizationScopeVersion()
  const { employees, labels } = useEmployeeLabels()

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const typeFilter = typeof values.leaveType === 'string' ? values.leaveType : undefined
  const employeeFilter = typeof values.employeeId === 'string' ? values.employeeId : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'start_date',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    if (typeFilter) out.leaveType = typeFilter
    if (employeeFilter) out.employeeId = employeeFilter
    return out
  }, [page, sorting, statusFilter, typeFilter, employeeFilter])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hr-leave-requests', params, scopeVersion],
    queryFn: () => fetchCrudList<LeaveRequestRow>(RESOURCE, params),
  })

  const decide = React.useCallback(async (approvalRequestId: string, action: 'approve' | 'reject') => {
    setBusyId(approvalRequestId)
    setActionError(null)
    try {
      await apiCallOrThrow(`/api/hr_management/approvals/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: approvalRequestId }),
      })
      await queryClient.invalidateQueries({ queryKey: ['hr-leave-requests'] })
    } catch (caught: unknown) {
      setActionError(caught instanceof Error && caught.message ? caught.message : t('hr_management.leaveRequests.error.decide', 'Could not record the decision.'))
    } finally {
      setBusyId(null)
    }
  }, [queryClient, t])

  const columns = React.useMemo<ColumnDef<LeaveRequestRow>[]>(() => [
    {
      id: 'employee',
      header: t('hr_management.leaveRequests.columns.employee', 'Employee'),
      cell: ({ row }) => labels.get(row.original.employee_id) ?? '—',
      meta: { priority: 1 },
    },
    {
      accessorKey: 'leave_type',
      header: t('hr_management.leaveRequests.columns.type', 'Leave type'),
      cell: ({ row }) => t(`hr_management.leaveRequests.type.${row.original.leave_type}`, TYPE_FALLBACKS[row.original.leave_type]),
    },
    { accessorKey: 'start_date', header: t('hr_management.leaveRequests.columns.start', 'From') },
    { accessorKey: 'end_date', header: t('hr_management.leaveRequests.columns.end', 'To') },
    {
      accessorKey: 'total_days',
      header: t('hr_management.leaveRequests.columns.days', 'Days'),
      cell: ({ row }) => (row.original.total_days === null || row.original.total_days === undefined ? '—' : String(row.original.total_days)),
    },
    {
      accessorKey: 'status',
      header: t('hr_management.leaveRequests.columns.status', 'Status'),
      cell: ({ row }) => (
        <Badge>{t(`hr_management.leaveRequests.status.${row.original.status}`, STATUS_FALLBACKS[row.original.status])}</Badge>
      ),
    },
  ], [t, labels])

  if (isError) {
    return <div className="text-sm text-destructive">{t('hr_management.leaveRequests.error.load', 'Could not load leave requests.')}</div>
  }

  return (
    <>
      {actionError ? <p className="mb-2 text-sm text-destructive">{actionError}</p> : null}
      <DataTable
        title={t('hr_management.leaveRequests.page.title', 'Leave requests')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('hr_management.leaveRequests.actions.create', 'New leave request')}</Link>
          </Button>
        )}
        rowActions={(row) => {
          const approvalRequestId = row.approval_request_id ?? null
          const isPending = row.status === 'pending'
          return (
            <div className="flex items-center gap-3">
              <Link className="text-sm font-medium underline" href={editHref(row.id)}>
                {t('hr_management.leaveRequests.actions.edit', 'Edit')}
              </Link>
              {isPending && approvalRequestId ? (
                <>
                  <Button type="button" size="sm" disabled={busyId === approvalRequestId} onClick={() => { void decide(approvalRequestId, 'approve') }}>
                    {t('hr_management.leaveRequests.actions.approve', 'Approve')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busyId === approvalRequestId} onClick={() => { void decide(approvalRequestId, 'reject') }}>
                    {t('hr_management.leaveRequests.actions.reject', 'Reject')}
                  </Button>
                </>
              ) : null}
              {isPending && !approvalRequestId ? (
                // No approval request exists yet, so there is nothing to decide: the edit
                // screen owns the workflow picker and the submit action.
                <Link className="text-sm font-medium underline" href={editHref(row.id)}>
                  {t('hr_management.leaveRequests.actions.submit', 'Submit for approval')}
                </Link>
              ) : null}
            </div>
          )
        }}
        columns={columns}
        data={data?.items ?? []}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('hr_management.leaveRequests.filters.status', 'Status'),
            type: 'select',
            options: STATUS_VALUES.map((value) => ({
              value,
              label: t(`hr_management.leaveRequests.status.${value}`, STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'leaveType',
            label: t('hr_management.leaveRequests.filters.type', 'Leave type'),
            type: 'select',
            options: LEAVE_TYPE_VALUES.map((value) => ({
              value,
              label: t(`hr_management.leaveRequests.type.${value}`, TYPE_FALLBACKS[value]),
            })),
          },
          {
            id: 'employeeId',
            label: t('hr_management.leaveRequests.filters.employee', 'Employee'),
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
        entityId="hr_management:hr_leave_request"
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
    </>
  )
}
