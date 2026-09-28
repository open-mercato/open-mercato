"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import type { AttendanceStatus } from '../data/entities'
import { useEmployeeLabels } from './hrOptions'
import type { AttendanceRow } from './AttendanceTable'

const ENTITY_ID = 'hr_management:hr_attendance_record'
const LIST_HREF = '/backend/hr/attendance'
const RESOURCE = 'hr_management/attendance'
const SUBMIT_ENDPOINT = '/api/hr_management/approvals/submit'

// Mirrors ATTENDANCE_STATUSES in data/entities.ts; the API rejects an unknown value.
const STATUS_VALUES: AttendanceStatus[] = ['present', 'absent', 'late', 'on_leave', 'holiday']

const STATUS_FALLBACKS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  on_leave: 'On leave',
  holiday: 'Holiday',
}

export type AttendanceFormValues = {
  id: string
  employeeId: string
  date: string
  checkInAt: string
  checkOutAt: string
  status: AttendanceStatus
  workedMinutes: string
  notes: string
  /**
   * Not part of the entity payload: choosing a workflow means "ask for this lateness to be excused"
   * after saving. The engine flips a `late` record to `present` when that request is approved, which
   * is why the picker only appears on a late record.
   */
  workflowId: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version
  // header from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/**
 * An instant as a `datetime-local` value in the viewer's own zone.
 *
 * Subtracting the offset before slicing keeps the field showing local wall-clock time; a
 * plain `toISOString().slice(0, 16)` would show UTC, and saving that back would shift the
 * stored instant by the offset on every edit.
 */
export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** A `datetime-local` value as the full ISO instant the schema requires (`z.string().datetime()`). */
export function fromLocalDateTimeInput(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Whole minutes between two `datetime-local` values, or null when the range is unusable. */
export function minutesBetween(checkInAt: string, checkOutAt: string): number | null {
  if (!checkInAt || !checkOutAt) return null
  const start = new Date(checkInAt).getTime()
  const end = new Date(checkOutAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  return Math.round((end - start) / 60_000)
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10)
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export function toAttendanceFormValues(row: AttendanceRow): AttendanceFormValues {
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: toDateOnly(row.date),
    checkInAt: toLocalDateTimeInput(row.check_in_at),
    checkOutAt: toLocalDateTimeInput(row.check_out_at),
    status: row.status,
    workedMinutes: row.worked_minutes === null || row.worked_minutes === undefined ? '' : String(row.worked_minutes),
    notes: row.notes ?? '',
    workflowId: '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildAttendanceFormDefaults(id = ''): AttendanceFormValues {
  return {
    id,
    employeeId: '',
    date: '',
    checkInAt: '',
    checkOutAt: '',
    status: 'present',
    workedMinutes: '',
    notes: '',
    workflowId: '',
    updatedAt: null,
  }
}

/**
 * Builds the entity payload.
 *
 * Instants are converted to full ISO strings because the schema validates them with
 * `z.string().datetime()`, which rejects the local `datetime-local` form. An explicit day
 * count wins over the range, and the range is counted when the field is left empty.
 */
export function toAttendancePayload(values: AttendanceFormValues): Record<string, unknown> {
  const explicit = values.workedMinutes.trim()
  const workedMinutes = explicit.length > 0
    ? Number(explicit)
    : minutesBetween(values.checkInAt, values.checkOutAt)
  return {
    employeeId: values.employeeId,
    date: values.date,
    checkInAt: fromLocalDateTimeInput(values.checkInAt),
    checkOutAt: fromLocalDateTimeInput(values.checkOutAt),
    status: values.status,
    ...(workedMinutes === null || Number.isNaN(workedMinutes) ? {} : { workedMinutes }),
    notes: values.notes.trim().length > 0 ? values.notes.trim() : null,
  }
}

type Translate = ReturnType<typeof useT>
type Option = { value: string; label: string }

function useEmployeePickerOptions(): Option[] {
  const { employees } = useEmployeeLabels()
  return React.useMemo<Option[]>(
    () => employees.map((employee) => ({ value: employee.id, label: `${employee.first_name} ${employee.last_name}`.trim() })),
    [employees],
  )
}

function useAttendanceFields(
  t: Translate,
  employeeOptions: Option[],
  workflowOptions: Option[],
  includeWorkflow: boolean,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const fields: CrudField[] = [
      {
        id: 'employeeId',
        label: t('hr_management.attendance.form.fields.employee', 'Employee'),
        type: 'select',
        required: true,
        options: employeeOptions,
      },
      { id: 'date', label: t('hr_management.attendance.form.fields.date', 'Attendance date'), type: 'date', required: true },
      {
        id: 'status',
        label: t('hr_management.attendance.form.fields.status', 'Status'),
        type: 'select',
        required: true,
        options: STATUS_VALUES.map((value) => ({
          value,
          label: t(`hr_management.attendance.status.${value}`, STATUS_FALLBACKS[value]),
        })),
      },
      { id: 'checkInAt', label: t('hr_management.attendance.form.fields.checkIn', 'Check in'), type: 'datetime-local' },
      { id: 'checkOutAt', label: t('hr_management.attendance.form.fields.checkOut', 'Check out'), type: 'datetime-local' },
      {
        id: 'workedMinutes',
        label: t('hr_management.attendance.form.fields.worked', 'Worked minutes'),
        type: 'number',
        description: t('hr_management.attendance.form.fields.workedHint', 'Leave empty to count the difference between check in and check out.'),
      },
      { id: 'notes', label: t('hr_management.attendance.form.fields.notes', 'Notes'), type: 'textarea' },
    ]
    if (includeWorkflow) {
      fields.push({
        id: 'workflowId',
        label: t('hr_management.attendance.form.fields.workflow', 'Approval workflow'),
        type: 'select',
        options: workflowOptions,
        description: t('hr_management.attendance.form.fields.workflowHint', 'Choosing a workflow asks for this lateness permission after saving; approval clears the lateness.'),
      })
    }
    return fields
  }, [t, employeeOptions, workflowOptions, includeWorkflow])
}

function useAttendanceGroups(t: Translate, workflow: 'none' | 'offer' | 'pending'): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => {
    const groups: CrudFormGroup[] = [
      { id: 'record', title: t('hr_management.attendance.form.groups.record'), column: 1, fields: ['employeeId', 'date', 'status'] },
      { id: 'times', title: t('hr_management.attendance.form.groups.times'), column: 2, fields: ['checkInAt', 'checkOutAt', 'workedMinutes'] },
      { id: 'notes', title: t('hr_management.attendance.form.groups.notes'), column: 1, fields: ['notes'] },
    ]
    if (workflow === 'offer') {
      groups.push({ id: 'approval', title: t('hr_management.attendance.form.groups.approval'), column: 2, fields: ['workflowId'] })
    }
    if (workflow === 'pending') {
      // The picker is absent because a request is already open. Saying so is the difference between
      // "the screen is broken" and "someone else has this in their queue".
      groups.push({
        id: 'approval',
        title: t('hr_management.attendance.form.groups.approval'),
        column: 2,
        component: () => (
          <p className="text-sm text-muted-foreground">
            {t('hr_management.attendance.form.approvalPending', 'A lateness permission for this record is already waiting for a decision.')}
          </p>
        ),
      })
    }
    return groups
  }, [t, workflow])
}

/** Active workflows, so a permission cannot be started against a definition nobody can act on. */
function useActiveWorkflowOptions(): Option[] {
  const t = useT()
  const [workflows, setWorkflows] = React.useState<Array<{ id: string; name: string }>>([])
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchCrudList<{ id: string; name: string }>('hr_management/approval-workflows', { pageSize: 50, isActive: true })
        if (!cancelled) setWorkflows(data?.items ?? [])
      } catch {
        if (!cancelled) setWorkflows([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [])
  return React.useMemo<Option[]>(() => [
    { value: '', label: t('hr_management.attendance.form.workflowNone', 'Do not ask for a permission') },
    ...workflows.map((workflow) => ({ value: workflow.id, label: workflow.name })),
  ], [t, workflows])
}

/** Starts a lateness permission for a saved attendance record. */
async function submitAttendanceForApproval(workflowId: string, attendanceId: string): Promise<void> {
  await apiCallOrThrow(SUBMIT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      entityType: 'hr_attendance_record',
      entityId: attendanceId,
    }),
  })
}

export function AttendanceCreateForm() {
  const t = useT()
  const employeeOptions = useEmployeePickerOptions()
  // No workflow picker on create: a lateness permission is about a record that already exists.
  const fields = useAttendanceFields(t, employeeOptions, [], false)
  const groups = useAttendanceGroups(t, 'none')
  const initialValues = React.useMemo(() => buildAttendanceFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.attendance.form.flash.saved', 'Attendance record saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<AttendanceFormValues>
      title={t('hr_management.attendance.form.create.title', 'New attendance record')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.attendance.form.create.submit', 'Create record')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toAttendancePayload(values))
      }}
    />
  )
}

export function AttendanceEditForm({ id }: { id: string }) {
  const t = useT()
  const employeeOptions = useEmployeePickerOptions()
  const workflowOptions = useActiveWorkflowOptions()
  const [initial, setInitial] = React.useState<AttendanceFormValues | null>(null)
  const [existingApprovalRequestId, setExistingApprovalRequestId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  // The permission picker is offered only where the engine can act on it: a record that is late and
  // has no request awaiting a decision. Re-offering it after a rejection is deliberate — that is how
  // a refused permission is retried with different words.
  const workflowMode = initial?.status !== 'late'
    ? 'none'
    : existingApprovalRequestId === null
      ? 'offer'
      : 'pending'
  const includeWorkflow = workflowMode === 'offer'
  const fields = useAttendanceFields(t, employeeOptions, workflowOptions, includeWorkflow)
  const groups = useAttendanceGroups(t, workflowMode)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<AttendanceRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toAttendanceFormValues(item))

        const requests = await fetchCrudList<{ id: string }>('hr_management/approval-requests', {
          entityType: 'hr_attendance_record',
          entityId: String(id),
          status: 'pending',
          pageSize: 1,
        })
        if (!cancelled) setExistingApprovalRequestId(requests?.items?.[0]?.id ?? null)
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.attendance.form.error.load', 'Could not load the attendance record.'))
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
    () => withFlash(LIST_HREF, t('hr_management.attendance.form.flash.saved', 'Attendance record saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.attendance.form.flash.deleted', 'Attendance record deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.attendance.form.error.notFound', 'Attendance record not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.attendance.actions.backToList', 'Back to attendance')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<AttendanceFormValues>
      title={t('hr_management.attendance.form.edit.title', 'Edit attendance record')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildAttendanceFormDefaults(id)}
      submitLabel={t('hr_management.attendance.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.attendance.form.loading', 'Loading attendance record…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toAttendancePayload(values) })
        // Only when the picker was actually offered: re-submitting an existing request would open a
        // second one against the same late record, and the API would happily allow it.
        if (includeWorkflow && values.workflowId) {
          await submitAttendanceForApproval(values.workflowId, id)
        }
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
