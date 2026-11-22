"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DriverRow, DriverStatus } from './TransportDriversTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'transport_operations:transport_driver'
const LIST_HREF = '/backend/transport/drivers'
const RESOURCE = 'transport_operations/drivers'

const STATUS_VALUES: DriverStatus[] = ['available', 'on_trip', 'on_leave', 'suspended']

const STATUS_FALLBACKS: Record<DriverStatus, string> = {
  available: 'Available',
  on_trip: 'On a trip',
  on_leave: 'On leave',
  suspended: 'Suspended',
}

export type DriverFormValues = {
  id: string
  fullName: string
  nationalId: string
  licenseNumber: string
  licenseExpiry: string
  phone: string
  userId: string
  status: DriverStatus
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

/**
 * Maps a loaded driver row into form values (snake_case from the list, camelCase in the form).
 *
 * `employee_id` is deliberately not mapped: the transport module does not import HR's option lookup
 * (modules stay independent), so the field is neither shown nor sent — an update leaves whatever the
 * record already had, because the update schema is partial.
 */
export function toDriverFormValues(row: DriverRow): DriverFormValues {
  return {
    id: row.id,
    fullName: row.full_name ?? '',
    nationalId: row.national_id ?? '',
    licenseNumber: row.license_number ?? '',
    licenseExpiry: toDateOnly(row.license_expiry),
    phone: row.phone ?? '',
    userId: row.user_id ?? '',
    status: row.status,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildDriverFormDefaults(id = ''): DriverFormValues {
  return {
    id,
    fullName: '',
    nationalId: '',
    licenseNumber: '',
    licenseExpiry: '',
    phone: '',
    userId: '',
    status: 'available',
    updatedAt: null,
  }
}

/** Turns form values into the payload the driver schemas accept. */
export function toDriverPayload(values: DriverFormValues): Record<string, unknown> {
  return {
    fullName: values.fullName.trim(),
    nationalId: values.nationalId.trim(),
    licenseNumber: values.licenseNumber.trim(),
    licenseExpiry: values.licenseExpiry,
    phone: values.phone.trim(),
    userId: values.userId.trim() || null,
    status: values.status,
  }
}

type Translate = ReturnType<typeof useT>

function useDriverFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'fullName', label: t('transport_operations.drivers.form.fields.fullName', 'Full name'), type: 'text', required: true, layout: 'half' },
    { id: 'nationalId', label: t('transport_operations.drivers.form.fields.nationalId', 'National id'), type: 'text', required: true, layout: 'half' },
    { id: 'phone', label: t('transport_operations.drivers.form.fields.phone', 'Phone'), type: 'text', required: true, layout: 'half' },
    { id: 'licenseNumber', label: t('transport_operations.drivers.form.fields.licenseNumber', 'Licence number'), type: 'text', required: true, layout: 'half' },
    { id: 'licenseExpiry', label: t('transport_operations.drivers.form.fields.licenseExpiry', 'Licence expiry'), type: 'date', required: true, layout: 'half' },
    {
      id: 'userId',
      label: t('transport_operations.drivers.form.fields.userId', 'Driver login user'),
      description: t(
        'transport_operations.drivers.form.hints.userId',
        'Staff user who can open the driver workspace. Leave empty for a driver without a login.',
      ),
      type: 'relation',
      layout: 'half',
      loadOptions: async (query?: string) => {
        const params = new URLSearchParams({ pageSize: '50' })
        if (query?.trim()) params.set('search', query.trim())
        const call = await apiCall<{ items?: Array<{ id: string; name?: string | null; email: string }> }>(
          `/api/auth/users?${params.toString()}`,
        )
        return (call.result?.items ?? []).map((user) => ({
          value: user.id,
          label: user.name?.trim() ? `${user.name} (${user.email})` : user.email,
        }))
      },
    },
    {
      id: 'status',
      label: t('transport_operations.drivers.form.fields.status', 'Status'),
      type: 'select',
      required: true,
      layout: 'half',
      options: STATUS_VALUES.map((value) => ({
        value,
        label: t(`transport_operations.drivers.status.${value}`, STATUS_FALLBACKS[value]),
      })),
    },
  ], [t])
}

function useDriverGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identity',
      title: t('transport_operations.drivers.form.groups.identity', 'Identity'),
      column: 1,
      fields: ['fullName', 'nationalId', 'phone', 'userId'],
    },
    {
      id: 'licence',
      title: t('transport_operations.drivers.form.groups.licence', 'Licence'),
      column: 2,
      fields: ['licenseNumber', 'licenseExpiry', 'status'],
    },
  ], [t])
}

export function DriverCreateForm() {
  const t = useT()
  const fields = useDriverFields(t)
  const groups = useDriverGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.drivers.form.flash.saved', 'Driver saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<DriverFormValues>
      title={t('transport_operations.drivers.form.create.title', 'New driver')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildDriverFormDefaults()}
      submitLabel={t('transport_operations.drivers.form.create.submit', 'Create driver')}
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
  const fields = useDriverFields(t)
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
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('transport_operations.drivers.form.error.load', 'Could not load the driver.'))
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
    () => withFlash(LIST_HREF, t('transport_operations.drivers.form.flash.saved', 'Driver saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.drivers.form.flash.deleted', 'Driver deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('transport_operations.drivers.form.error.notFound', 'Driver not found.')}
        backHref={LIST_HREF}
        backLabel={t('transport_operations.drivers.actions.backToList', 'Back to drivers')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<DriverFormValues>
      title={t('transport_operations.drivers.form.edit.title', 'Edit driver')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildDriverFormDefaults(id)}
      submitLabel={t('transport_operations.drivers.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('transport_operations.drivers.form.loading', 'Loading driver…')}
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
