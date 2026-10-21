"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { VehicleAssignmentDialog } from './VehicleAssignmentDialog'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'fleet_management:fleet_vehicle'
const LIST_HREF = '/backend/fleet/vehicles'
const RESOURCE = 'fleet_management/vehicles'

export type VehicleStatus = 'active' | 'assigned' | 'maintenance' | 'out_of_service'

export const VEHICLE_STATUS_VALUES: VehicleStatus[] = ['active', 'maintenance', 'out_of_service']

export type VehicleRow = {
  id: string
  plate_number: string
  sequence_number?: string | null
  make: string
  model: string
  year: number
  color?: string | null
  vehicle_type?: string | null
  status: VehicleStatus
  current_odometer: number
  assigned_employee_id?: string | null
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

export type VehicleFormValues = {
  id: string
  plateNumber: string
  sequenceNumber: string
  make: string
  model: string
  year: number
  color: string
  vehicleType: string
  status: VehicleStatus
  currentOdometer: number
  notes: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the
  // expected-version header from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/**
 * Maps a loaded vehicle row into the form's initial values.
 *
 * The list API answers in snake_case (the query engine projects columns as stored)
 * while the create/update schemas speak camelCase, so both conversions live here.
 *
 * Exported as a pure function so the optimistic-lock wiring is testable:
 * `CrudForm` auto-derives the expected-version header from `initialValues.updatedAt`,
 * so dropping `updatedAt` here silently disables optimistic locking for update and
 * delete while every other assertion in the module still passes.
 */
export function toVehicleFormValues(row: VehicleRow): VehicleFormValues {
  return {
    id: row.id,
    plateNumber: row.plate_number ?? '',
    sequenceNumber: row.sequence_number ?? '',
    make: row.make ?? '',
    model: row.model ?? '',
    year: Number(row.year ?? new Date().getUTCFullYear()),
    color: row.color ?? '',
    vehicleType: row.vehicle_type ?? '',
    // `assigned` is derived from an open custody assignment, not a stored status;
    // editing a vehicle in custody edits the underlying active register state.
    status: row.status === 'assigned' ? 'active' : row.status,
    currentOdometer: Number(row.current_odometer ?? 0),
    notes: row.notes ?? '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildVehicleFormDefaults(id = ''): VehicleFormValues {
  return {
    id,
    plateNumber: '',
    sequenceNumber: '',
    make: '',
    model: '',
    year: new Date().getUTCFullYear(),
    color: '',
    vehicleType: '',
    status: 'active',
    currentOdometer: 0,
    notes: '',
    updatedAt: null,
  }
}

type Translate = ReturnType<typeof useT>

function useVehicleFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'plateNumber', label: t('fleet_management.vehicles.form.fields.plate'), type: 'text', required: true },
    { id: 'sequenceNumber', label: t('fleet_management.vehicles.form.fields.sequence'), type: 'text' },
    { id: 'make', label: t('fleet_management.vehicles.form.fields.make'), type: 'text', required: true },
    { id: 'model', label: t('fleet_management.vehicles.form.fields.model'), type: 'text', required: true },
    { id: 'year', label: t('fleet_management.vehicles.form.fields.year'), type: 'number', required: true },
    { id: 'color', label: t('fleet_management.vehicles.form.fields.color'), type: 'text' },
    { id: 'vehicleType', label: t('fleet_management.vehicles.form.fields.type'), type: 'text' },
    {
      id: 'status',
      label: t('fleet_management.vehicles.form.fields.status'),
      type: 'select',
      required: true,
      options: VEHICLE_STATUS_VALUES.map((value) => ({
        value,
        label: t(`fleet_management.vehicles.status.${value}`, value),
      })),
    },
    { id: 'currentOdometer', label: t('fleet_management.vehicles.form.fields.odometer'), type: 'number', required: true },
    { id: 'notes', label: t('fleet_management.vehicles.form.fields.notes'), type: 'textarea' },
  ], [t])
}

function useVehicleGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'identification', title: t('fleet_management.vehicles.form.groups.identification'), column: 1, fields: ['plateNumber', 'sequenceNumber', 'make', 'model'] },
    { id: 'specification', title: t('fleet_management.vehicles.form.groups.specification'), column: 2, fields: ['year', 'color', 'vehicleType', 'status'] },
    { id: 'usage', title: t('fleet_management.vehicles.form.groups.usage'), column: 1, fields: ['currentOdometer', 'notes'] },
  ], [t])
}
export function VehicleCreateForm() {
  const t = useT()
  const fields = useVehicleFields(t)
  const groups = useVehicleGroups(t)
  const initialValues = React.useMemo(() => buildVehicleFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('fleet_management.vehicles.form.flash.saved'), 'success'),
    [t],
  )

  return (
    <CrudForm<VehicleFormValues>
      title={t('fleet_management.vehicles.form.create.title')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('fleet_management.vehicles.form.create.submit')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, values)
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
  const [reloadKey, setReloadKey] = React.useState(0)

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
            setError(caught instanceof Error && caught.message ? caught.message : t('fleet_management.vehicles.form.error.load'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t, reloadKey])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('fleet_management.vehicles.form.flash.saved'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('fleet_management.vehicles.form.flash.deleted'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('fleet_management.vehicles.form.error.notFound')}
        backHref={LIST_HREF}
        backLabel={t('fleet_management.vehicles.actions.backToList', 'Back to vehicles')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<VehicleFormValues>
      title={t('fleet_management.vehicles.form.edit.title')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      extraActions={(
        <VehicleAssignmentDialog
          vehicleId={id}
          handoverOdometer={initial?.currentOdometer ?? 0}
          isInCustody={initial?.status === 'assigned'}
          disabled={loading}
          onDone={() => setReloadKey((value) => value + 1)}
        />
      )}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildVehicleFormDefaults(id)}
      submitLabel={t('fleet_management.vehicles.form.edit.submit')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('fleet_management.vehicles.form.loading')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, values)
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
