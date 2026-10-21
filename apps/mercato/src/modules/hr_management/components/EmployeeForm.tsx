"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import type { EmployeeStatus, EmploymentType } from '../data/entities'
import { employeeLabel, useDepartmentOptions, useEmployeeLabels } from './hrOptions'
import type { EmployeeRow } from './EmployeesTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'hr_management:hr_employee'
const LIST_HREF = '/backend/hr/employees'
const RESOURCE = 'hr_management/employees'

// Mirrors data/entities.ts; see the note in EmployeesTable.tsx.
const STATUS_VALUES: EmployeeStatus[] = ['active', 'on_leave', 'suspended', 'terminated']
const IDENTITY_VALUES: Array<'national_id' | 'iqama'> = ['national_id', 'iqama']
const EMPLOYMENT_VALUES: EmploymentType[] = ['full_time', 'part_time', 'contract', 'temporary']

const STATUS_FALLBACKS: Record<EmployeeStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  suspended: 'Suspended',
  terminated: 'Terminated',
}

export type EmployeeFormValues = {
  id: string
  employeeNumber: string
  firstName: string
  lastName: string
  identityType: 'national_id' | 'iqama'
  nationalId: string
  nationalIdExpiry: string
  departmentId: string
  managerEmployeeId: string
  jobTitle: string
  employmentType: EmploymentType
  status: EmployeeStatus
  hireDate: string
  terminationDate: string
  email: string
  phone: string
  bankIban: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the
  // expected-version header from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

/**
 * Maps a loaded employee row into the form's initial values.
 *
 * The list answers in snake_case (the query engine projects columns as stored) while
 * the create/update schemas speak camelCase, so both conversions live here. `updatedAt`
 * is threaded for the reason above: dropping it silently disables optimistic locking.
 */
export function toEmployeeFormValues(row: EmployeeRow): EmployeeFormValues {
  return {
    id: row.id,
    employeeNumber: row.employee_number ?? '',
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    identityType: row.identity_type ?? 'national_id',
    nationalId: row.national_id ?? '',
    nationalIdExpiry: toDateOnly(row.national_id_expiry),
    departmentId: row.department_id ?? '',
    managerEmployeeId: row.manager_employee_id ?? '',
    jobTitle: row.job_title ?? '',
    employmentType: row.employment_type ?? 'full_time',
    status: row.status,
    hireDate: toDateOnly(row.hire_date),
    terminationDate: toDateOnly(row.termination_date),
    email: row.email ?? '',
    phone: row.phone ?? '',
    bankIban: row.bank_iban ?? '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildEmployeeFormDefaults(id = ''): EmployeeFormValues {
  return {
    id,
    employeeNumber: '',
    firstName: '',
    lastName: '',
    identityType: 'national_id',
    nationalId: '',
    nationalIdExpiry: '',
    departmentId: '',
    managerEmployeeId: '',
    jobTitle: '',
    employmentType: 'full_time',
    status: 'active',
    hireDate: '',
    terminationDate: '',
    email: '',
    phone: '',
    bankIban: '',
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * Empty optional text becomes `null` rather than `''` so a value can be cleared on
 * update (`updateEmployeeSchema` is `partial().nullable()` for those fields), and the
 * required ones are always sent. The three enums are never empty because the form
 * offers no empty option, so they are sent as chosen.
 */
export function toEmployeePayload(values: EmployeeFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  return {
    employeeNumber: values.employeeNumber.trim(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    identityType: values.identityType,
    nationalId: values.nationalId.trim(),
    nationalIdExpiry: optional(values.nationalIdExpiry),
    departmentId: values.departmentId.length > 0 ? values.departmentId : null,
    managerEmployeeId: values.managerEmployeeId.length > 0 ? values.managerEmployeeId : null,
    jobTitle: values.jobTitle.trim(),
    employmentType: values.employmentType,
    status: values.status,
    hireDate: values.hireDate,
    terminationDate: optional(values.terminationDate),
    email: optional(values.email),
    phone: optional(values.phone),
    bankIban: optional(values.bankIban),
  }
}

type Translate = ReturnType<typeof useT>

function useEmployeeFields(
  t: Translate,
  departmentOptions: Array<{ value: string; label: string }>,
  managerOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'employeeNumber', label: t('hr_management.employees.form.fields.employeeNumber', 'Employee number'), type: 'text', required: true },
    { id: 'firstName', label: t('hr_management.employees.form.fields.firstName', 'First name'), type: 'text', required: true },
    { id: 'lastName', label: t('hr_management.employees.form.fields.lastName', 'Last name'), type: 'text', required: true },
    {
      id: 'identityType',
      label: t('hr_management.employees.form.fields.identityType', 'Identity type'),
      type: 'select',
      required: true,
      options: IDENTITY_VALUES.map((value) => ({
        value,
        label: t(`hr_management.employees.identity.${value}`, value === 'iqama' ? 'Iqama' : 'National ID'),
      })),
    },
    { id: 'nationalId', label: t('hr_management.employees.form.fields.nationalId', 'Identity number'), type: 'text', required: true },
    { id: 'nationalIdExpiry', label: t('hr_management.employees.form.fields.nationalIdExpiry', 'Identity expiry'), type: 'date' },
    {
      id: 'departmentId',
      label: t('hr_management.employees.form.fields.department', 'Department'),
      type: 'select',
      options: departmentOptions,
    },
    {
      id: 'managerEmployeeId',
      label: t('hr_management.employees.form.fields.manager', 'Direct manager'),
      type: 'select',
      options: managerOptions,
    },
    { id: 'jobTitle', label: t('hr_management.employees.form.fields.jobTitle', 'Job title'), type: 'text', required: true },
    {
      id: 'employmentType',
      label: t('hr_management.employees.form.fields.employmentType', 'Employment type'),
      type: 'select',
      required: true,
      options: EMPLOYMENT_VALUES.map((value) => ({
        value,
        label: t(`hr_management.employees.employment.${value}`, value),
      })),
    },
    {
      id: 'status',
      label: t('hr_management.employees.form.fields.status', 'Status'),
      type: 'select',
      required: true,
      options: STATUS_VALUES.map((value) => ({
        value,
        label: t(`hr_management.employees.status.${value}`, STATUS_FALLBACKS[value]),
      })),
    },
    { id: 'hireDate', label: t('hr_management.employees.form.fields.hireDate', 'Hire date'), type: 'date', required: true },
    { id: 'terminationDate', label: t('hr_management.employees.form.fields.terminationDate', 'Termination date'), type: 'date' },
    { id: 'email', label: t('hr_management.employees.form.fields.email', 'Email'), type: 'text' },
    { id: 'phone', label: t('hr_management.employees.form.fields.phone', 'Phone'), type: 'text' },
    { id: 'bankIban', label: t('hr_management.employees.form.fields.bankIban', 'Bank IBAN'), type: 'text' },
  ], [t, departmentOptions, managerOptions])
}

function useEmployeeGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'name', title: t('hr_management.employees.form.groups.name'), column: 1, fields: ['employeeNumber', 'firstName', 'lastName'] },
    { id: 'identity', title: t('hr_management.employees.form.groups.identity'), column: 2, fields: ['identityType', 'nationalId', 'nationalIdExpiry'] },
    { id: 'employment', title: t('hr_management.employees.form.groups.employment'), column: 1, fields: ['departmentId', 'managerEmployeeId', 'jobTitle', 'employmentType', 'status'] },
    { id: 'dates', title: t('hr_management.employees.form.groups.dates'), column: 2, fields: ['hireDate', 'terminationDate'] },
    { id: 'contact', title: t('hr_management.employees.form.groups.contact'), column: 1, fields: ['email', 'phone', 'bankIban'] },
  ], [t])
}

/** Department options for the form, with an explicit empty entry so the field is clearable. */
function useSelectableDepartments(): Array<{ value: string; label: string }> {
  const t = useT()
  const { departments } = useDepartmentOptions()
  return React.useMemo(() => [
    { value: '', label: t('hr_management.employees.form.fields.departmentNone', 'Not assigned') },
    ...departments.map((department) => ({ value: department.id, label: department.name })),
  ], [departments, t])
}

function useSelectableManagers(currentEmployeeId: string): Array<{ value: string; label: string }> {
  const t = useT()
  const { employees } = useEmployeeLabels()
  return React.useMemo(() => [
    { value: '', label: t('hr_management.employees.form.fields.managerNone', 'No manager') },
    ...employees
      .filter((employee) => employee.id !== currentEmployeeId)
      .map((employee) => ({ value: employee.id, label: employeeLabel(employee) })),
  ], [employees, currentEmployeeId, t])
}

export function EmployeeCreateForm() {
  const t = useT()
  const departmentOptions = useSelectableDepartments()
  const managerOptions = useSelectableManagers('')
  const fields = useEmployeeFields(t, departmentOptions, managerOptions)
  const groups = useEmployeeGroups(t)
  const initialValues = React.useMemo(() => buildEmployeeFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.employees.form.flash.saved', 'Employee saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<EmployeeFormValues>
      title={t('hr_management.employees.form.create.title', 'New employee')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.employees.form.create.submit', 'Create employee')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toEmployeePayload(values))
      }}
    />
  )
}

export function EmployeeEditForm({ id }: { id: string }) {
  const t = useT()
  const departmentOptions = useSelectableDepartments()
  const managerOptions = useSelectableManagers(id)
  const fields = useEmployeeFields(t, departmentOptions, managerOptions)
  const groups = useEmployeeGroups(t)
  const [initial, setInitial] = React.useState<EmployeeFormValues | null>(null)
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
        const data = await fetchCrudList<EmployeeRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toEmployeeFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.employees.form.error.load', 'Could not load the employee.'))
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
    () => withFlash(LIST_HREF, t('hr_management.employees.form.flash.saved', 'Employee saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.employees.form.flash.deleted', 'Employee deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.employees.form.error.notFound', 'Employee not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.employees.actions.backToList', 'Back to employees')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<EmployeeFormValues>
      title={t('hr_management.employees.form.edit.title', 'Edit employee')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildEmployeeFormDefaults(id)}
      submitLabel={t('hr_management.employees.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.employees.form.loading', 'Loading employee…')}
      onSubmit={async (values) => {
        // `id` must be in the body: the route has no id segment and `updateEmployeeSchema` requires
        // it, so omitting it made every save fail validation with a 400 that the form reported as
        // "Could not save". The sibling forms already spread it in; this one did not.
        await updateCrud(RESOURCE, { id, ...toEmployeePayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}


