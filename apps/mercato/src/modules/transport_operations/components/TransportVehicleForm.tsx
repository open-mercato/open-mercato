"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { VehicleRow, VehicleStatus } from './TransportVehiclesTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
// The row type is a type-only import, which erases at compile time.
const ENTITY_ID = 'transport_operations:transport_vehicle'
const LIST_HREF = '/backend/transport/vehicles'
const RESOURCE = 'transport_operations/vehicles'

const STATUS_VALUES: VehicleStatus[] = ['active', 'maintenance', 'out_of_service']

export const STATUS_FALLBACKS: Record<VehicleStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  out_of_service: 'Out of service',
}

export type VehicleFormValues = {
  id: string
  plateNumber: string
  vin: string
  sequenceNumber: string
  make: string
  model: string
  year: number
  capacity: number
  color: string
  vehicleType: string
  currentOdometer: number
  status: VehicleStatus
  telematicsDeviceId: string
  notes: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/**
 * Maps a loaded vehicle row into the form's initial values.
 *
 * The list API answers in snake_case (the query engine projects columns as stored) while the
 * create/update schemas speak camelCase, so both conversions live here — and in `toVehiclePayload`.
 * Exported as a pure function so the optimistic-lock wiring is testable: dropping `updatedAt` here
 * silently disables optimistic locking for update and delete while every other assertion still
 * passes.
 */
export function toVehicleFormValues(row: VehicleRow): VehicleFormValues {
  return {
    id: row.id,
    plateNumber: row.plate_number ?? '',
    vin: row.vin ?? '',
    sequenceNumber: row.sequence_number ?? '',
    make: row.make ?? '',
    model: row.model ?? '',
    year: Number(row.year ?? new Date().getUTCFullYear()),
    capacity: Number(row.capacity ?? 0),
    color: row.color ?? '',
    vehicleType: row.vehicle_type ?? '',
    currentOdometer: Number(row.current_odometer ?? 0),
    status: row.status,
    telematicsDeviceId: row.telematics_device_id ?? '',
    notes: row.notes ?? '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildVehicleFormDefaults(id = ''): VehicleFormValues {
  return {
    id,
    plateNumber: '',
    vin: '',
    sequenceNumber: '',
    make: '',
    model: '',
    year: new Date().getUTCFullYear(),
    capacity: 0,
    color: '',
    vehicleType: '',
    currentOdometer: 0,
    status: 'active',
    telematicsDeviceId: '',
    notes: '',
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * Empty optional text becomes `null` so an update can clear it; the year and capacity inputs are
 * numbers already, because the schemas coerce and a blank number input must not arrive as `NaN`.
 */
export function toVehiclePayload(values: VehicleFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  return {
    plateNumber: values.plateNumber.trim(),
    vin: optional(values.vin),
    sequenceNumber: optional(values.sequenceNumber),
    make: values.make.trim(),
    model: values.model.trim(),
    year: Number.isFinite(values.year) ? values.year : undefined,
    capacity: Number.isFinite(values.capacity) ? values.capacity : 0,
    color: optional(values.color),
    vehicleType: optional(values.vehicleType),
    currentOdometer: Number.isFinite(values.currentOdometer) ? values.currentOdometer : 0,
    status: values.status,
    telematicsDeviceId: optional(values.telematicsDeviceId),
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function useVehicleFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'plateNumber', label: t('transport_operations.vehicles.form.fields.plate', 'Plate number'), type: 'text', required: true, layout: 'half' },
    { id: 'vin', label: t('transport_operations.vehicles.form.fields.vin', 'Chassis number (VIN)'), type: 'text', layout: 'half' },
    { id: 'sequenceNumber', label: t('transport_operations.vehicles.form.fields.sequence', 'Fleet sequence number'), type: 'text', layout: 'half' },
    { id: 'make', label: t('transport_operations.vehicles.form.fields.make', 'Make'), type: 'text', required: true, layout: 'half' },
    { id: 'model', label: t('transport_operations.vehicles.form.fields.model', 'Model'), type: 'text', required: true, layout: 'half' },
    { id: 'year', label: t('transport_operations.vehicles.form.fields.year', 'Year'), type: 'number', required: true, layout: 'half' },
    { id: 'capacity', label: t('transport_operations.vehicles.form.fields.capacity', 'Passenger seats'), type: 'number', layout: 'half' },
    { id: 'color', label: t('transport_operations.vehicles.form.fields.color', 'Colour'), type: 'text', layout: 'half' },
    { id: 'vehicleType', label: t('transport_operations.vehicles.form.fields.type', 'Vehicle type'), type: 'text', layout: 'half' },
    { id: 'currentOdometer', label: t('transport_operations.vehicles.form.fields.odometer', 'Current odometer'), type: 'number', layout: 'half' },
    {
      id: 'status',
      label: t('transport_operations.vehicles.form.fields.status', 'Status'),
      type: 'select',
      required: true,
      layout: 'half',
      options: STATUS_VALUES.map((value) => ({
        value,
        label: t(`transport_operations.vehicles.status.${value}`, STATUS_FALLBACKS[value]),
      })),
    },
    { id: 'telematicsDeviceId', label: t('transport_operations.vehicles.form.fields.telematicsDevice', 'Telematics device id'), type: 'text', layout: 'half' },
    { id: 'notes', label: t('transport_operations.vehicles.form.fields.notes', 'Notes'), type: 'textarea', rows: 3 },
  ], [t])
}

function useVehicleGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identification',
      title: t('transport_operations.vehicles.form.groups.identification', 'Identification'),
      column: 1,
      fields: ['plateNumber', 'vin', 'sequenceNumber', 'make', 'model'],
    },
    {
      id: 'specification',
      title: t('transport_operations.vehicles.form.groups.specification', 'Specification'),
      column: 2,
      fields: ['year', 'capacity', 'color', 'vehicleType', 'currentOdometer', 'status'],
    },
    {
      id: 'telematics',
      title: t('transport_operations.vehicles.form.groups.telematics', 'Telematics'),
      column: 1,
      fields: ['telematicsDeviceId', 'notes'],
    },
  ], [t])
}

export function VehicleCreateForm() {
  const t = useT()
  const fields = useVehicleFields(t)
  const groups = useVehicleGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.vehicles.form.flash.saved', 'Vehicle saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<VehicleFormValues>
      title={t('transport_operations.vehicles.form.create.title', 'New vehicle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildVehicleFormDefaults()}
      submitLabel={t('transport_operations.vehicles.form.create.submit', 'Create vehicle')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toVehiclePayload(values))
      }}
    />
  )
}

export function VehicleEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useVehicleFields(t)
  const groups = useVehicleGroups(t)
  const [initial, setInitial] = React.useState<VehicleFormValues | null>(null)
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
        const data = await fetchCrudList<VehicleRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toVehicleFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('transport_operations.vehicles.form.error.load', 'Could not load the vehicle.'))
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
    () => withFlash(LIST_HREF, t('transport_operations.vehicles.form.flash.saved', 'Vehicle saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.vehicles.form.flash.deleted', 'Vehicle deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('transport_operations.vehicles.form.error.notFound', 'Vehicle not found.')}
        backHref={LIST_HREF}
        backLabel={t('transport_operations.vehicles.actions.backToList', 'Back to vehicles')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<VehicleFormValues>
      title={t('transport_operations.vehicles.form.edit.title', 'Edit vehicle')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildVehicleFormDefaults(id)}
      submitLabel={t('transport_operations.vehicles.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('transport_operations.vehicles.form.loading', 'Loading vehicle…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toVehiclePayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
