"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TripRow } from './TransportTripsTable'
import {
  driverLabel,
  routeLabel,
  useDriverOptions,
  useRouteOptions,
  useVehicleOptions,
  vehicleLabel,
} from './transportOptions'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'transport_operations:transport_trip_schedule'
const LIST_HREF = '/backend/transport/trips'
const RESOURCE = 'transport_operations/trips'

export type TripFormValues = {
  id: string
  routeId: string
  vehicleId: string
  driverId: string
  scheduledStartTime: string
  scheduledEndTime: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/**
 * ISO instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input expects, in the operator's own zone.
 *
 * The stored value is UTC; the input is wall-clock. Converting with `toISOString().slice(0, 16)` would
 * show the UTC time as if it were local, so every trip would appear shifted by the offset — a bug that
 * only shows up for the operator who then saves the shifted value back.
 */
export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `YYYY-MM-DDTHH:mm` from the input → the ISO instant the schema requires. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function toTripFormValues(row: TripRow): TripFormValues {
  return {
    id: row.id,
    routeId: row.route_id ?? '',
    vehicleId: row.vehicle_id ?? '',
    driverId: row.driver_id ?? '',
    scheduledStartTime: toDateTimeLocal(row.scheduled_start_time),
    scheduledEndTime: toDateTimeLocal(row.scheduled_end_time),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildTripFormDefaults(id = ''): TripFormValues {
  return {
    id,
    routeId: '',
    vehicleId: '',
    driverId: '',
    scheduledStartTime: '',
    scheduledEndTime: '',
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the trip schemas accept.
 *
 * A date the input left empty is omitted rather than sent as `null`: the create schema requires both
 * instants (`z.string().datetime()`), and `null` would fail as a type error instead of the
 * "required field" message the form already shows. `status` is deliberately absent — it moves only
 * through the dispatch and complete commands.
 */
export function toTripPayload(values: TripFormValues): Record<string, unknown> {
  const start = fromDateTimeLocal(values.scheduledStartTime)
  const end = fromDateTimeLocal(values.scheduledEndTime)
  return {
    routeId: values.routeId,
    vehicleId: values.vehicleId,
    driverId: values.driverId,
    ...(start ? { scheduledStartTime: start } : {}),
    ...(end ? { scheduledEndTime: end } : {}),
  }
}

type Translate = ReturnType<typeof useT>
type SelectOption = { value: string; label: string }

function useTripFields(
  t: Translate,
  routeOptions: SelectOption[],
  vehicleOptions: SelectOption[],
  driverOptions: SelectOption[],
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'routeId',
      label: t('transport_operations.trips.form.fields.route', 'Route'),
      type: 'select',
      required: true,
      layout: 'half',
      options: routeOptions,
    },
    {
      id: 'vehicleId',
      label: t('transport_operations.trips.form.fields.vehicle', 'Vehicle'),
      type: 'select',
      required: true,
      layout: 'half',
      options: vehicleOptions,
    },
    {
      id: 'driverId',
      label: t('transport_operations.trips.form.fields.driver', 'Driver'),
      type: 'select',
      required: true,
      layout: 'half',
      options: driverOptions,
    },
    {
      id: 'scheduledStartTime',
      label: t('transport_operations.trips.form.fields.scheduledStart', 'Scheduled start'),
      type: 'datetime-local',
      required: true,
      layout: 'half',
    },
    {
      id: 'scheduledEndTime',
      label: t('transport_operations.trips.form.fields.scheduledEnd', 'Scheduled end'),
      type: 'datetime-local',
      required: true,
      layout: 'half',
    },
  ], [driverOptions, routeOptions, t, vehicleOptions])
}

function useTripGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'assignment',
      title: t('transport_operations.trips.form.groups.assignment', 'Assignment'),
      column: 1,
      fields: ['routeId', 'vehicleId', 'driverId'],
    },
    {
      id: 'schedule',
      title: t('transport_operations.trips.form.groups.schedule', 'Schedule'),
      column: 2,
      fields: ['scheduledStartTime', 'scheduledEndTime'],
    },
  ], [t])
}

function useTripOptions() {
  const { routes } = useRouteOptions()
  const { vehicles } = useVehicleOptions()
  const { drivers } = useDriverOptions()
  const routeOptions = React.useMemo(() => routes.map((route) => ({ value: route.id, label: routeLabel(route) })), [routes])
  const vehicleOptions = React.useMemo(() => vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicleLabel(vehicle) })), [vehicles])
  const driverOptions = React.useMemo(() => drivers.map((driver) => ({ value: driver.id, label: driverLabel(driver) })), [drivers])
  return { routeOptions, vehicleOptions, driverOptions }
}

export function TripCreateForm() {
  const t = useT()
  const { routeOptions, vehicleOptions, driverOptions } = useTripOptions()
  const fields = useTripFields(t, routeOptions, vehicleOptions, driverOptions)
  const groups = useTripGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.trips.form.flash.saved', 'Trip saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<TripFormValues>
      title={t('transport_operations.trips.form.create.title', 'Schedule trip')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildTripFormDefaults()}
      submitLabel={t('transport_operations.trips.form.create.submit', 'Schedule trip')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toTripPayload(values))
      }}
    />
  )
}

export function TripEditForm({ id }: { id: string }) {
  const t = useT()
  const { routeOptions, vehicleOptions, driverOptions } = useTripOptions()
  const fields = useTripFields(t, routeOptions, vehicleOptions, driverOptions)
  const groups = useTripGroups(t)
  const [initial, setInitial] = React.useState<TripFormValues | null>(null)
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
        const data = await fetchCrudList<TripRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toTripFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('transport_operations.trips.form.error.load', 'Could not load the trip.'))
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
    () => withFlash(LIST_HREF, t('transport_operations.trips.form.flash.saved', 'Trip saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('transport_operations.trips.form.flash.deleted', 'Trip deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('transport_operations.trips.form.error.notFound', 'Trip not found.')}
        backHref={LIST_HREF}
        backLabel={t('transport_operations.trips.actions.backToList', 'Back to trips')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<TripFormValues>
      title={t('transport_operations.trips.form.edit.title', 'Edit trip')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildTripFormDefaults(id)}
      submitLabel={t('transport_operations.trips.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('transport_operations.trips.form.loading', 'Loading trip…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        // The service re-checks vehicle and driver availability, so a rescheduled trip that now
        // collides is refused with a translated 409 instead of being written.
        await updateCrud(RESOURCE, { id, ...toTripPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
