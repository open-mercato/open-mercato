"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { formatDate } from '@open-mercato/ui/utils/format'
import { useT, useLocale, useDirection } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

import type { LeaveType } from '../data/entities'
import { useEmployeeLabels } from './hrOptions'

const RESOURCE = 'hr_management/leave-entitlements'
const CREATE_HREF = '/backend/hr/leave-entitlements/create'
const editHref = (id: string) => `/backend/hr/leave-entitlements/${id}/edit`

const LEAVE_TYPE_VALUES: LeaveType[] = ['annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other']

const LEAVE_TYPE_FALLBACKS: Record<LeaveType, string> = {
  annual: 'Annual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  emergency: 'Emergency',
  maternity: 'Maternity',
  other: 'Other',
}

export type LeaveEntitlementRow = {
  id: string
  employee_id: string
  leave_type: LeaveType
  period_start: string
  period_end: string
  entitled_days: string
  carry_over_days: string
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type RunLeaveAccrualDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: () => void
}

function RunLeaveAccrualDialog({ open, onOpenChange, onCompleted }: RunLeaveAccrualDialogProps) {
  const t = useT()
  const { employees } = useEmployeeLabels()
  const [month, setMonth] = React.useState(() => new Date().toISOString().slice(0, 7))
  const [employeeId, setEmployeeId] = React.useState('')
  const [leaveType, setLeaveType] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setResult(null)
  }, [open])

  const submit = React.useCallback(() => {
    if (submitting || month.length !== 7) return
    setSubmitting(true)
    setError(null)
    void (async () => {
      try {
        const response = await apiCallOrThrow<{ created: number; skipped: number; daysAdded: string }>(
          '/api/hr_management/leave-accruals/run',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              month,
              ...(employeeId ? { employeeId } : {}),
              ...(leaveType ? { leaveType } : {}),
            }),
          },
        )
        const payload = response.result ?? { created: 0, skipped: 0, daysAdded: '0.00' }
        setResult(t('hr_management.leaveEntitlements.accrual.result', 'Accrued {created} row(s), skipped {skipped}, {days} day(s) added.', {
          created: String(payload.created),
          skipped: String(payload.skipped),
          days: payload.daysAdded,
        }))
        onCompleted()
      } catch (caught: unknown) {
        setError(caught instanceof Error && caught.message
          ? caught.message
          : t('hr_management.leaveEntitlements.accrual.error', 'Could not run leave accrual.'))
      } finally {
        setSubmitting(false)
      }
    })()
  }, [employeeId, leaveType, month, onCompleted, submitting, t])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !submitting) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('hr_management.leaveEntitlements.accrual.title', 'Run leave accrual')}</DialogTitle>
          <DialogDescription>
            {t('hr_management.leaveEntitlements.accrual.description', 'Accrues one month of entitled days. Running the same month again adds nothing.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('hr_management.leaveEntitlements.accrual.month', 'Month')}</span>
            <input
              type="month"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('hr_management.leaveEntitlements.accrual.employee', 'Employee (optional)')}</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              <option value="">{t('hr_management.leaveEntitlements.accrual.allEmployees', 'All employees')}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{`${employee.first_name} ${employee.last_name}`.trim()}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">{t('hr_management.leaveEntitlements.accrual.type', 'Leave type (optional)')}</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={leaveType}
              onChange={(event) => setLeaveType(event.target.value)}
            >
              <option value="">{t('hr_management.leaveEntitlements.accrual.allTypes', 'All leave types')}</option>
              {LEAVE_TYPE_VALUES.map((value) => (
                <option key={value} value={value}>{t(`hr_management.leaveRequests.type.${value}`, LEAVE_TYPE_FALLBACKS[value])}</option>
              ))}
            </select>
          </label>
          {result ? <p className="text-sm text-status-success-text">{result}</p> : null}
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('hr_management.leaveEntitlements.accrual.close', 'Close')}
          </Button>
          <Button type="button" disabled={submitting || month.length !== 7} onClick={submit}>
            {submitting
              ? t('hr_management.leaveEntitlements.accrual.running', 'Running…')
              : t('hr_management.leaveEntitlements.accrual.submit', 'Run accrual')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function LeaveEntitlementsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const queryClient = useQueryClient()
  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'periodStart', desc: true }])
  const [page, setPage] = React.useState(1)
  const [accrualOpen, setAccrualOpen] = React.useState(false)

  const { labels: employeeLabels, employees } = useEmployeeLabels()
  const employeeFilter = typeof values.employeeId === 'string' ? values.employeeId : undefined
  const typeFilter = typeof values.leaveType === 'string' ? values.leaveType : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'periodStart',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (employeeFilter) out.employeeId = employeeFilter
    if (typeFilter) out.leaveType = typeFilter
    return out
  }, [page, sorting, employeeFilter, typeFilter])

  const query = useQuery({
    queryKey: ['hr-leave-entitlements', params, scopeVersion],
    queryFn: () => fetchCrudList<LeaveEntitlementRow>(RESOURCE, params),
  })

  const columns = React.useMemo<ColumnDef<LeaveEntitlementRow>[]>(() => [
    {
      id: 'employee',
      header: t('hr_management.leaveEntitlements.columns.employee', 'Employee'),
      cell: ({ row }) => <span className="text-sm font-medium">{employeeLabels.get(row.original.employee_id) ?? '—'}</span>,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'leave_type',
      header: t('hr_management.leaveEntitlements.columns.type', 'Leave type'),
      cell: ({ row }) => t(`hr_management.leaveRequests.type.${row.original.leave_type}`, LEAVE_TYPE_FALLBACKS[row.original.leave_type]),
      meta: { priority: 1 },
    },
    {
      id: 'period',
      header: t('hr_management.leaveEntitlements.columns.period', 'Period'),
      cell: ({ row }) => (
        <span className="text-sm">
          {formatDate(row.original.period_start, locale) ?? row.original.period_start}
          {' – '}
          {formatDate(row.original.period_end, locale) ?? row.original.period_end}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'entitled_days',
      header: t('hr_management.leaveEntitlements.columns.entitled', 'Entitled days'),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.entitled_days}</span>,
      meta: { priority: 2 },
    },
    {
      accessorKey: 'carry_over_days',
      header: t('hr_management.leaveEntitlements.columns.carryOver', 'Carry-over'),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.carry_over_days}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'notes',
      header: t('hr_management.leaveEntitlements.columns.notes', 'Notes'),
      cell: ({ getValue }) => {
        const value = getValue() as string | null
        return value && value.length > 0
          ? <span className="text-sm">{value}</span>
          : <span className="text-xs text-muted-foreground">—</span>
      },
      meta: { priority: 4 },
    },
  ], [employeeLabels, locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('hr_management.leaveEntitlements.error.load', 'Could not load leave entitlements.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('hr_management.leaveEntitlements.page.title', 'Leave entitlements')}
        titleHeadingLevel={1}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setAccrualOpen(true)}>
              {t('hr_management.leaveEntitlements.actions.runAccrual', 'Run accrual')}
            </Button>
            <Button asChild>
              <Link href={CREATE_HREF}>{t('hr_management.leaveEntitlements.actions.create', 'New entitlement')}</Link>
            </Button>
          </div>
        )}
        rowActions={(row) => (
          <Link className="text-sm font-medium underline" href={editHref(row.id)}>
            {t('hr_management.leaveEntitlements.actions.edit', 'Edit')}
          </Link>
        )}
        columns={columns}
        data={query.data?.items ?? []}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'leaveType',
            label: t('hr_management.leaveEntitlements.filters.type', 'Leave type'),
            type: 'select',
            options: LEAVE_TYPE_VALUES.map((value) => ({
              value,
              label: t(`hr_management.leaveRequests.type.${value}`, LEAVE_TYPE_FALLBACKS[value]),
            })),
          },
          {
            id: 'employeeId',
            label: t('hr_management.leaveEntitlements.filters.employee', 'Employee'),
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
        entityId="hr_management:hr_leave_entitlement"
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        pagination={{
          page,
          pageSize: 50,
          total: query.data?.total ?? 0,
          totalPages: query.data?.totalPages ?? 0,
          totalIsCapped: query.data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={query.isLoading}
      />
      <RunLeaveAccrualDialog
        open={accrualOpen}
        onOpenChange={setAccrualOpen}
        onCompleted={() => { void queryClient.invalidateQueries({ queryKey: ['hr-leave-entitlements'] }) }}
      />
    </>
  )
}
