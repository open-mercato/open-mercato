"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useEmployeeLabels } from './hrOptions'
import type { DriverRow } from './DriversTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'hr_management:hr_driver_profile'
const LIST_HREF = '/backend/hr/drivers'
const RESOURCE = 'hr_management/driver-profiles'

export type DriverFormValues = {
  id: string
  employeeId: string
  licenseNumber: string
  licenseType: string
  licenseExpiry: string
  medicalCheckExpiry: string
  yearsOfExperience: string
  notes: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

/** Maps a loaded row into form values (snake_case from the list, camelCase in the form). */
export function toDriverFormValues(row: DriverRow): DriverFormValues {
  return {
    id: row.id,
    employeeId: row.employee_id ?? '',
    licenseNumber: row.license_number ?? '',
    licenseType: row.license_type ?? '',
    licenseExpiry: toDateOnly(row.license_expiry),
    medicalCheckExpiry: toDateOnly(row.medical_check_expiry),
    yearsOfExperience: row.years_of_experience === null || row.years_of_experience === undefined
      ? ''
      : String(row.years_of_experience),
    notes: row.notes ?? '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildDriverFormDefaults(id = ''): DriverFormValues {
  return {
    id,
    employeeId: '',
    licenseNumber: '',
    licenseType: '',
    licenseExpiry: '',
    medicalCheckExpiry: '',
    yearsOfExperience: '',
    notes: '',
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * Empty optional text becomes `null` so an update can clear it. The experience count is parsed here
 * rather than by a number input, because an empty string must become "unset" and not `NaN`.
 */
export function toDriverPayload(values: DriverFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  const years = values.yearsOfExperience.trim().length > 0
    ? Number.parseInt(values.yearsOfExperience.trim(), 10)
    : Number.NaN
  return {
    employeeId: values.employeeId,
    licenseNumber: values.licenseNumber.trim(),
    licenseType: optional(values.licenseType),
    licenseExpiry: values.licenseExpiry,
    medicalCheckExpiry: optional(values.medicalCheckExpiry),
    yearsOfExperience: Number.isFinite(years) ? years : null,
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function useDriverFields(
  t: Translate,
  employeeOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'employeeId',
      label: t('hr_management.drivers.form.fields.employee', 'Driver'),
      type: 'select',
      required: true,
      options: employeeOptions,
    },
    { id: 'licenseNumber', label: t('hr_management.drivers.form.fields.licenseNumber', 'Licence number'), type: 'text', required: true },
    { id: 'licenseType', label: t('hr_management.drivers.form.fields.licenseType', 'Licence type'), type: 'text' },
    { id: 'licenseExpiry', label: t('hr_management.drivers.form.fields.licenseExpiry', 'Licence expiry'), type: 'date', required: true },
    {
      id: 'medicalCheckExpiry',
      label: t('hr_management.drivers.form.fields.medicalExpiry', 'Medical check expiry'),
      type: 'date',
      help: t('hr_management.drivers.form.fields.medicalExpiryHint', 'Both dates are watched: the driver is compliant only while both are valid.'),
    },
    { id: 'yearsOfExperience', label: t('hr_management.drivers.form.fields.experience', 'Years of experience'), type: 'number' },
    { id: 'notes', label: t('hr_management.drivers.form.fields.notes', 'Notes'), type: 'textarea', rows: 3 },
  ], [employeeOptions, t])
}

function useDriverGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'driver', title: t('hr_management.drivers.form.groups.driver'), column: 1, fields: ['employeeId', 'licenseNumber', 'licenseType', 'yearsOfExperience'] },
    { id: 'compliance', title: t('hr_management.drivers.form.groups.compliance'), column: 2, fields: ['licenseExpiry', 'medicalCheckExpiry', 'notes'] },
  ], [t])
}

/** Employee options with an explicit empty entry, because a driver is always a known employee. */
function useDriverEmployeeOptions() {
  const t = useT()
  const { employees } = useEmployeeLabels()
  return React.useMemo(() => [
    { value: '', label: t('hr_management.drivers.form.fields.employeeNone', 'Select an employee') },
    ...employees.map((employee) => ({
      value: employee.id,
      label: `${employee.first_name} ${employee.last_name}`.trim(),
    })),
  ], [employees, t])
}

export function DriverCreateForm() {
  const t = useT()
  const employeeOptions = useDriverEmployeeOptions()
  const fields = useDriverFields(t, employeeOptions)
  const groups = useDriverGroups(t)
  const initialValues = React.useMemo(() => buildDriverFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.drivers.form.flash.saved', 'Driver profile saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<DriverFormValues>
      title={t('hr_management.drivers.form.create.title', 'New driver profile')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.drivers.form.create.submit', 'Create driver profile')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toDriverPayload(values))
      }}
    />
  )
}

export function DriverEditForm({ id }: { id: string }) {
  const t = useT()
  const employeeOptions = useDriverEmployeeOptions()
  const fields = useDriverFields(t, employeeOptions)
  const groups = useDriverGroups(t)
  const [initial, setInitial] = React.useState<DriverFormValues | null>(null)
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
        const data = await fetchCrudList<DriverRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toDriverFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.drivers.form.error.load', 'Could not load the driver profile.'))
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
    () => withFlash(LIST_HREF, t('hr_management.drivers.form.flash.saved', 'Driver profile saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.drivers.form.flash.deleted', 'Driver profile deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.drivers.form.error.notFound', 'Driver profile not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.drivers.actions.backToList', 'Back to drivers')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<DriverFormValues>
      title={t('hr_management.drivers.form.edit.title', 'Edit driver profile')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildDriverFormDefaults(id)}
      submitLabel={t('hr_management.drivers.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.drivers.form.loading', 'Loading driver profile…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toDriverPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
