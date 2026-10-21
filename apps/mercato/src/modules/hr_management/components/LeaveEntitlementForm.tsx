"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import type { LeaveType } from '../data/entities'
import type { LeaveEntitlementRow } from './LeaveEntitlementsTable'
import { useEmployeeLabels } from './hrOptions'

const ENTITY_ID = 'hr_management:hr_leave_entitlement'
const LIST_HREF = '/backend/hr/leave-entitlements'
const RESOURCE = 'hr_management/leave-entitlements'

const LEAVE_TYPE_VALUES: LeaveType[] = ['annual', 'sick', 'unpaid', 'emergency', 'maternity', 'other']

const LEAVE_TYPE_FALLBACKS: Record<LeaveType, string> = {
  annual: 'Annual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  emergency: 'Emergency',
  maternity: 'Maternity',
  other: 'Other',
}

export type LeaveEntitlementFormValues = {
  id: string
  employeeId: string
  leaveType: LeaveType
  periodStart: string
  periodEnd: string
  entitledDays: string | number
  carryOverDays: string | number
  notes: string
  updatedAt?: string | null
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

export function toLeaveEntitlementFormValues(row: LeaveEntitlementRow): LeaveEntitlementFormValues {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type,
    periodStart: toDateOnly(row.period_start),
    periodEnd: toDateOnly(row.period_end),
    entitledDays: row.entitled_days ?? '0',
    carryOverDays: row.carry_over_days ?? '0',
    notes: row.notes ?? '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildLeaveEntitlementDefaults(id = ''): LeaveEntitlementFormValues {
  const year = new Date().getUTCFullYear()
  return {
    id,
    employeeId: '',
    leaveType: 'annual',
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    entitledDays: '0',
    carryOverDays: '0',
    notes: '',
    updatedAt: null,
  }
}

export function toLeaveEntitlementPayload(values: LeaveEntitlementFormValues): Record<string, unknown> {
  // Number fields come back as numbers, text/initial values as strings; both are
  // valid inputs for the zod schema, which coerces to the decimal string the API stores.
  const day = (value: string | number | null | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0'
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    return '0'
  }
  return {
    employeeId: values.employeeId,
    leaveType: values.leaveType,
    periodStart: values.periodStart,
    periodEnd: values.periodEnd,
    entitledDays: day(values.entitledDays),
    carryOverDays: day(values.carryOverDays),
    notes: values.notes.trim().length > 0 ? values.notes.trim() : null,
  }
}

type Translate = ReturnType<typeof useT>

function useEntitlementFields(
  t: Translate,
  employeeOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'employeeId',
      label: t('hr_management.leaveEntitlements.form.fields.employee', 'Employee'),
      type: 'select',
      required: true,
      options: employeeOptions,
    },
    {
      id: 'leaveType',
      label: t('hr_management.leaveEntitlements.form.fields.type', 'Leave type'),
      type: 'select',
      required: true,
      options: LEAVE_TYPE_VALUES.map((value) => ({
        value,
        label: t(`hr_management.leaveRequests.type.${value}`, LEAVE_TYPE_FALLBACKS[value]),
      })),
    },
    {
      id: 'periodStart',
      label: t('hr_management.leaveEntitlements.form.fields.periodStart', 'Period start'),
      type: 'date',
      required: true,
    },
    {
      id: 'periodEnd',
      label: t('hr_management.leaveEntitlements.form.fields.periodEnd', 'Period end'),
      type: 'date',
      required: true,
    },
    {
      id: 'entitledDays',
      label: t('hr_management.leaveEntitlements.form.fields.entitled', 'Entitled days'),
      type: 'number',
      required: true,
      help: t('hr_management.leaveEntitlements.form.fields.entitledHint', 'The days this employee may take in the period. Monthly accrual adds one twelfth of this value.'),
    },
    {
      id: 'carryOverDays',
      label: t('hr_management.leaveEntitlements.form.fields.carryOver', 'Carry-over days'),
      type: 'number',
      help: t('hr_management.leaveEntitlements.form.fields.carryOverHint', 'Days brought forward from the previous period.'),
    },
    { id: 'notes', label: t('hr_management.leaveEntitlements.form.fields.notes', 'Notes'), type: 'textarea', rows: 3 },
  ], [employeeOptions, t])
}

function useEntitlementGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employee', title: t('hr_management.leaveEntitlements.form.groups.employee'), column: 1, fields: ['employeeId', 'leaveType'] },
    { id: 'period', title: t('hr_management.leaveEntitlements.form.groups.period'), column: 2, fields: ['periodStart', 'periodEnd', 'entitledDays', 'carryOverDays'] },
    { id: 'notes', title: t('hr_management.leaveEntitlements.form.groups.notes'), column: 1, fields: ['notes'] },
  ], [t])
}

function useEntitlementEmployeeOptions() {
  const t = useT()
  const { employees } = useEmployeeLabels()
  return React.useMemo(() => [
    { value: '', label: t('hr_management.leaveEntitlements.form.fields.employeeNone', 'Select an employee') },
    ...employees.map((employee) => ({
      value: employee.id,
      label: `${employee.first_name} ${employee.last_name}`.trim(),
    })),
  ], [employees, t])
}

export function LeaveEntitlementCreateForm() {
  const t = useT()
  const employeeOptions = useEntitlementEmployeeOptions()
  const fields = useEntitlementFields(t, employeeOptions)
  const groups = useEntitlementGroups(t)
  const initialValues = React.useMemo(() => buildLeaveEntitlementDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.leaveEntitlements.form.flash.saved', 'Leave entitlement saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<LeaveEntitlementFormValues>
      title={t('hr_management.leaveEntitlements.form.create.title', 'New leave entitlement')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.leaveEntitlements.form.create.submit', 'Create entitlement')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toLeaveEntitlementPayload(values))
      }}
    />
  )
}

export function LeaveEntitlementEditForm({ id }: { id: string }) {
  const t = useT()
  const employeeOptions = useEntitlementEmployeeOptions()
  const fields = useEntitlementFields(t, employeeOptions)
  const groups = useEntitlementGroups(t)
  const [initial, setInitial] = React.useState<LeaveEntitlementFormValues | null>(null)
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
        const data = await fetchCrudList<LeaveEntitlementRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toLeaveEntitlementFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.leaveEntitlements.form.error.load', 'Could not load the leave entitlement.'))
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
    () => withFlash(LIST_HREF, t('hr_management.leaveEntitlements.form.flash.saved', 'Leave entitlement saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.leaveEntitlements.form.flash.deleted', 'Leave entitlement deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.leaveEntitlements.form.error.notFound', 'Leave entitlement not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.leaveEntitlements.actions.backToList', 'Back to leave entitlements')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<LeaveEntitlementFormValues>
      title={t('hr_management.leaveEntitlements.form.edit.title', 'Edit leave entitlement')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildLeaveEntitlementDefaults(id)}
      submitLabel={t('hr_management.leaveEntitlements.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.leaveEntitlements.form.loading', 'Loading leave entitlement…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toLeaveEntitlementPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
