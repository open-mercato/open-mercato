"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import type { LeaveRequestStatus, LeaveType } from '../data/entities'
import { useEmployeeLabels, type LeaveRequestRow } from './LeaveRequestsTable'

const ENTITY_ID = 'hr_management:hr_leave_request'
const LIST_HREF = '/backend/hr/leave-requests'
const RESOURCE = 'hr_management/leave-requests'
const SUBMIT_ENDPOINT = '/api/hr_management/approvals/submit'

// Mirrors the enums in data/entities.ts; the API rejects an unknown value, so a drift is
// loud rather than silent.
const LEAVE_TYPE_VALUES: LeaveType[] = ['annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other']
const STATUS_VALUES: LeaveRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled']

const STATUS_FALLBACKS: Record<LeaveRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const TYPE_FALLBACKS: Record<LeaveType, string> = {
  annual: 'Annual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  emergency: 'Emergency',
  maternity: 'Maternity',
  other: 'Other',
}

export type LeaveRequestFormValues = {
  id: string
  employeeId: string
  leaveType: LeaveType
  startDate: string
  endDate: string
  totalDays: string
  reason: string
  status: LeaveRequestStatus
  /**
   * Not part of the entity payload: selecting a workflow means "run this approval now after
   * saving". An empty value leaves the request without an approval, which the list surfaces
   * as `Submit for approval`.
   */
  workflowId: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version
  // header from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

/** Maps a loaded leave request row into the form's initial values. */
export function toLeaveRequestFormValues(row: LeaveRequestRow): LeaveRequestFormValues {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type,
    startDate: toDateOnly(row.start_date),
    endDate: toDateOnly(row.end_date),
    totalDays: row.total_days === null || row.total_days === undefined ? '' : String(row.total_days),
    reason: row.reason ?? '',
    status: row.status,
    workflowId: '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildLeaveRequestFormDefaults(id = ''): LeaveRequestFormValues {
  return {
    id,
    employeeId: '',
    leaveType: 'annual',
    startDate: '',
    endDate: '',
    totalDays: '',
    reason: '',
    status: 'pending',
    workflowId: '',
    updatedAt: null,
  }
}

/**
 * Builds the entity payload.
 *
 * `workflowId` and `status` are deliberately excluded: the workflow is an instruction to the
 * approval engine, and the status belongs to the engine and the CRUD default (`pending`),
 * never to the form.
 */
export function toLeaveRequestPayload(values: LeaveRequestFormValues): Record<string, unknown> {
  const explicitDays = values.totalDays.trim()
  // An explicit value wins; otherwise the range is counted so a request never stores a null
  // day count just because the operator left the field empty.
  const totalDays = explicitDays.length > 0
    ? Number(explicitDays)
    : countInclusiveDays(values.startDate, values.endDate)
  return {
    employeeId: values.employeeId,
    leaveType: values.leaveType,
    startDate: values.startDate,
    endDate: values.endDate,
    ...(totalDays === null || Number.isNaN(totalDays) ? {} : { totalDays }),
    reason: values.reason.trim().length > 0 ? values.reason.trim() : null,
  }
}

/** The whole date range counts as leave here; partial days are not modelled. */
export function countInclusiveDays(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null
  const start = new Date(`${toDateOnly(startDate)}T00:00:00Z`)
  const end = new Date(`${toDateOnly(endDate)}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  if (diff < 0) return null
  return diff + 1
}

type Translate = ReturnType<typeof useT>
type Option = { value: string; label: string }
type WorkflowRow = { id: string; name: string }

function useActiveWorkflowOptions(): Option[] {
  const t = useT()
  const [workflows, setWorkflows] = React.useState<WorkflowRow[]>([])
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchCrudList<WorkflowRow>('hr_management/approval-workflows', { pageSize: 50, isActive: true })
        if (!cancelled) setWorkflows(data?.items ?? [])
      } catch {
        if (!cancelled) setWorkflows([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [])
  return React.useMemo<Option[]>(() => [
    { value: '', label: t('hr_management.leaveRequests.form.workflowNone', 'Do not submit for approval') },
    ...workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
  ], [workflows, t])
}

function useEmployeePickerOptions(): Option[] {
  const { employees } = useEmployeeLabels()
  return React.useMemo<Option[]>(
    () => employees.map((employee) => ({ value: employee.id, label: `${employee.first_name} ${employee.last_name}`.trim() })),
    [employees],
  )
}

function useLeaveFields(
  t: Translate,
  employeeOptions: Option[],
  workflowOptions: Option[],
  includeStatus: boolean,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const fields: CrudField[] = [
      {
        id: 'employeeId',
        label: t('hr_management.leaveRequests.form.fields.employee', 'Employee'),
        type: 'select',
        required: true,
        options: employeeOptions,
      },
      {
        id: 'leaveType',
        label: t('hr_management.leaveRequests.form.fields.type', 'Leave type'),
        type: 'select',
        required: true,
        options: LEAVE_TYPE_VALUES.map((value) => ({
          value,
          label: t(`hr_management.leaveRequests.type.${value}`, TYPE_FALLBACKS[value]),
        })),
      },
      { id: 'startDate', label: t('hr_management.leaveRequests.form.fields.start', 'From'), type: 'date', required: true },
      { id: 'endDate', label: t('hr_management.leaveRequests.form.fields.end', 'To'), type: 'date', required: true },
      {
        id: 'totalDays',
        label: t('hr_management.leaveRequests.form.fields.days', 'Days'),
        type: 'number',
        description: t('hr_management.leaveRequests.form.fields.daysHint', 'Leave empty to let the server count the range.'),
      },
      { id: 'reason', label: t('hr_management.leaveRequests.form.fields.reason', 'Reason'), type: 'textarea' },
      {
        id: 'workflowId',
        label: t('hr_management.leaveRequests.form.fields.workflow', 'Approval workflow'),
        type: 'select',
        options: workflowOptions,
        description: t('hr_management.leaveRequests.form.fields.workflowHint', 'Choosing a workflow submits the request for approval after saving.'),
      },
    ]
    if (includeStatus) {
      fields.push({
        id: 'status',
        label: t('hr_management.leaveRequests.form.fields.status', 'Status'),
        type: 'select',
        options: STATUS_VALUES.map((value) => ({
          value,
          label: t(`hr_management.leaveRequests.status.${value}`, STATUS_FALLBACKS[value]),
        })),
        description: t('hr_management.leaveRequests.form.fields.statusHint', 'Approvals normally move this value; override only to correct a record.'),
      })
    }
    return fields
  }, [t, employeeOptions, workflowOptions, includeStatus])
}

function useLeaveGroups(t: Translate, includeStatus: boolean): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'request', title: t('hr_management.leaveRequests.form.groups.request'), column: 1, fields: ['employeeId', 'leaveType'] },
    { id: 'range', title: t('hr_management.leaveRequests.form.groups.range'), column: 2, fields: ['startDate', 'endDate', 'totalDays'] },
    { id: 'details', title: t('hr_management.leaveRequests.form.groups.details'), column: 1, fields: ['reason'] },
    {
      id: 'approval',
      title: t('hr_management.leaveRequests.form.groups.approval'),
      column: 2,
      fields: includeStatus ? ['workflowId', 'status'] : ['workflowId'],
    },
  ], [t, includeStatus])
}

/** Starts an approval request for a saved leave request. */
async function submitForApproval(workflowId: string, leaveRequestId: string): Promise<void> {
  await apiCallOrThrow(SUBMIT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      entityType: 'hr_leave_request',
      entityId: leaveRequestId,
    }),
  })
}

export function LeaveRequestCreateForm() {
  const t = useT()
  const employeeOptions = useEmployeePickerOptions()
  const workflowOptions = useActiveWorkflowOptions()
  const fields = useLeaveFields(t, employeeOptions, workflowOptions, false)
  const groups = useLeaveGroups(t, false)
  const initialValues = React.useMemo(() => buildLeaveRequestFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.leaveRequests.form.flash.saved', 'Leave request saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<LeaveRequestFormValues>
      title={t('hr_management.leaveRequests.form.create.title', 'New leave request')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.leaveRequests.form.create.submit', 'Create leave request')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        const created = (await createCrud(RESOURCE, toLeaveRequestPayload(values))) as unknown as { id?: string } | null
        const leaveRequestId = created && typeof created.id === 'string' ? created.id : ''
        // The request must exist before an approval can point at it, so this runs after the
        // create has committed. A failure here leaves the leave request saved without an
        // approval, which the list shows as `Submit for approval` rather than losing it.
        if (values.workflowId && leaveRequestId) {
          await submitForApproval(values.workflowId, leaveRequestId)
        }
      }}
    />
  )
}

export function LeaveRequestEditForm({ id }: { id: string }) {
  const t = useT()
  const employeeOptions = useEmployeePickerOptions()
  const workflowOptions = useActiveWorkflowOptions()
  const fields = useLeaveFields(t, employeeOptions, workflowOptions, true)
  const groups = useLeaveGroups(t, true)
  const [initial, setInitial] = React.useState<LeaveRequestFormValues | null>(null)
  const [existingApprovalRequestId, setExistingApprovalRequestId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<LeaveRequestRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          setInitial(toLeaveRequestFormValues(item))
          setExistingApprovalRequestId(item.approval_request_id ?? null)
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.leaveRequests.form.error.load', 'Could not load the leave request.'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.leaveRequests.form.flash.saved', 'Leave request saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.leaveRequests.form.flash.deleted', 'Leave request deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.leaveRequests.form.error.notFound', 'Leave request not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.leaveRequests.actions.backToList', 'Back to leave requests')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<LeaveRequestFormValues>
      title={t('hr_management.leaveRequests.form.edit.title', 'Edit leave request')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildLeaveRequestFormDefaults(id)}
      submitLabel={t('hr_management.leaveRequests.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.leaveRequests.form.loading', 'Loading leave request…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toLeaveRequestPayload(values), ...(values.status ? { status: values.status } : {}) })
        // Only start an approval when none exists: re-submitting an already-running request
        // would open a second one against the same leave.
        if (values.workflowId && !existingApprovalRequestId) {
          await submitForApproval(values.workflowId, id)
        }
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}

