"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TRIP_SOURCE_FALLBACKS, TRIP_SOURCE_VALUES } from '../lib/freightEnums'
import {
  useContractRateLineOptions,
  useTransportReference,
  useTripReadyOrderOptions,
} from './freightOptions'
import type { FreightTripRow } from './FreightTripsTable'
import { LIST_HREF } from './tripListMeta'
import type { TripBillingStatus } from '../data/entities'

const ENTITY_ID = 'freight_operations:freight_trip'
const RESOURCE = 'freight_operations/trips'

export type TripFormValues = {
  id: string
  source: string
  contractRouteId: string
  freightOrderId: string
  executionDate: string
  quantity: string
  vehicleId: string
  driverId: string
  actualStartAt: string
  actualEndAt: string
  waitingMinutes: string
  distanceKm: string
  notes: string
  updatedAt?: string | null
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

export function toTripFormValues(row: FreightTripRow): TripFormValues {
  const raw = row as unknown as Record<string, unknown>
  return {
    id: row.id,
    source: textOf(row.source) || 'contract',
    contractRouteId: textOf(raw.contract_route_id),
    freightOrderId: textOf(raw.freight_order_id),
    executionDate: dateOnly(row.execution_date),
    quantity: textOf(raw.quantity),
    vehicleId: textOf(raw.vehicle_id),
    driverId: textOf(raw.driver_id),
    actualStartAt: toDateTimeLocal(raw.actual_start_at as string | null),
    actualEndAt: toDateTimeLocal(raw.actual_end_at as string | null),
    waitingMinutes: textOf(raw.waiting_minutes),
    distanceKm: textOf(raw.distance_km),
    notes: textOf(raw.notes),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildTripFormDefaults(): TripFormValues {
  return {
    id: '',
    source: 'contract',
    contractRouteId: '',
    freightOrderId: '',
    executionDate: new Date().toISOString().slice(0, 10),
    quantity: '',
    vehicleId: '',
    driverId: '',
    actualStartAt: '',
    actualEndAt: '',
    waitingMinutes: '',
    distanceKm: '',
    notes: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

/**
 * Record builds the full payload; edit deliberately omits the source and the
 * three foreign keys — the update command ignores them, and sending them would
 * suggest the screen can move a trip to another contract.
 */
export function toTripPayload(
  values: TripFormValues,
  mode: 'create' | 'edit',
  contractIdOf: (rateLineId: string) => string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    executionDate: values.executionDate,
    quantity: optional(values.quantity),
    vehicleId: optional(values.vehicleId),
    driverId: optional(values.driverId),
    actualStartAt: fromDateTimeLocal(values.actualStartAt),
    actualEndAt: fromDateTimeLocal(values.actualEndAt),
    waitingMinutes: optional(values.waitingMinutes),
    distanceKm: optional(values.distanceKm),
    notes: optional(values.notes),
  }
  if (mode === 'create') {
    const source = values.source || 'contract'
    payload.source = source
    if (source === 'contract') {
      payload.contractRouteId = values.contractRouteId
      payload.contractId = contractIdOf(values.contractRouteId)
    } else {
      payload.freightOrderId = values.freightOrderId
    }
  }
  return payload
}

type Translate = ReturnType<typeof useT>

function useTripFields(
  t: Translate,
  mode: 'create' | 'edit',
  rateLineOptions: Array<{ value: string; label: string }>,
  orderOptions: Array<{ value: string; label: string }>,
  vehicleOptions: Array<{ value: string; label: string }>,
  driverOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  const isEdit = mode === 'edit'
  const lockedHint = isEdit
    ? t('freight_operations.trips.form.fields.sourceLocked', 'The source cannot be changed after the trip is recorded.')
    : undefined
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'source',
      label: t('freight_operations.trips.form.fields.source', 'Source'),
      type: 'select',
      readOnly: isEdit,
      description: lockedHint,
      options: TRIP_SOURCE_VALUES.map((value) => ({
        value,
        label: t(`freight_operations.trips.source.${value}`, TRIP_SOURCE_FALLBACKS[value] ?? value),
      })),
      layout: 'half',
    },
    {
      id: 'contractRouteId',
      label: t('freight_operations.trips.form.fields.rateLine', 'Contract rate line'),
      type: 'select',
      required: !isEdit,
      readOnly: isEdit,
      description: lockedHint,
      visibleWhen: { field: 'source', equals: 'contract' },
      options: rateLineOptions,
      layout: 'half',
    },
    {
      id: 'freightOrderId',
      label: t('freight_operations.trips.form.fields.order', 'Spot order'),
      type: 'select',
      required: !isEdit,
      readOnly: isEdit,
      description: lockedHint,
      visibleWhen: { field: 'source', equals: 'spot' },
      options: orderOptions,
      layout: 'half',
    },
    {
      id: 'executionDate',
      label: t('freight_operations.trips.form.fields.executionDate', 'Execution date'),
      type: 'date',
      required: true,
      layout: 'half',
    },
    {
      id: 'quantity',
      label: t('freight_operations.trips.form.fields.quantity', 'Quantity'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'vehicleId',
      label: t('freight_operations.trips.form.fields.vehicle', 'Vehicle'),
      type: 'select',
      options: vehicleOptions,
      layout: 'half',
    },
    {
      id: 'driverId',
      label: t('freight_operations.trips.form.fields.driver', 'Driver'),
      type: 'select',
      options: driverOptions,
      layout: 'half',
    },
    {
      id: 'actualStartAt',
      label: t('freight_operations.trips.form.fields.actualStart', 'Actual start'),
      type: 'datetime-local',
      layout: 'half',
    },
    {
      id: 'actualEndAt',
      label: t('freight_operations.trips.form.fields.actualEnd', 'Actual end'),
      type: 'datetime-local',
      layout: 'half',
    },
    {
      id: 'waitingMinutes',
      label: t('freight_operations.trips.form.fields.waiting', 'Waiting (minutes)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'distanceKm',
      label: t('freight_operations.trips.form.fields.distance', 'Distance (km)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'notes',
      label: t('freight_operations.trips.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [driverOptions, isEdit, lockedHint, orderOptions, rateLineOptions, t, vehicleOptions])
}

function useTripGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'source',
      title: t('freight_operations.trips.form.groups.source', 'Billing source'),
      column: 1,
      fields: ['source', 'contractRouteId', 'freightOrderId'],
    },
    {
      id: 'execution',
      title: t('freight_operations.trips.form.groups.execution', 'Execution'),
      column: 2,
      fields: ['executionDate', 'quantity', 'vehicleId', 'driverId', 'actualStartAt', 'actualEndAt', 'waitingMinutes', 'distanceKm'],
    },
    {
      id: 'notes',
      title: t('freight_operations.trips.form.groups.notes', 'Notes'),
      column: 1,
      fields: ['notes'],
    },
  ], [t])
}

export function TripCreateForm() {
  const t = useT()
  const { options: rateLineOptions, byId } = useContractRateLineOptions()
  const orderOptions = useTripReadyOrderOptions()
  const { vehicleOptions, driverOptions } = useTransportReference()
  const fields = useTripFields(t, 'create', rateLineOptions, orderOptions, vehicleOptions, driverOptions)
  const groups = useTripGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('freight_operations.trips.form.flash.saved', 'Trip recorded.'), 'success'),
    [t],
  )
  const contractIdOf = React.useCallback((rateLineId: string) => byId.get(rateLineId)?.contractId ?? null, [byId])

  return (
    <CrudForm<TripFormValues>
      title={t('freight_operations.trips.form.create.title', 'Record trip')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildTripFormDefaults()}
      submitLabel={t('freight_operations.trips.form.create.submit', 'Record trip')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        const payload = toTripPayload(values, 'create', contractIdOf)
        if (values.source === 'contract' && !payload.contractId) {
          const message = t('freight_operations.trips.form.error.rateLineMissing', 'Choose a contract rate line.')
          throw createCrudFormError(message, { contractRouteId: message })
        }
        await createCrud(RESOURCE, payload)
      }}
    />
  )
}

export function TripEditForm({ id }: { id: string }) {
  const t = useT()
  const { options: loadedRateLineOptions } = useContractRateLineOptions()
  const orderOptions = useTripReadyOrderOptions()
  const { vehicleOptions, driverOptions } = useTransportReference()
  const [initial, setInitial] = React.useState<TripFormValues | null>(null)
  const [billingStatus, setBillingStatus] = React.useState<TripBillingStatus | null>(null)
  const [lockedTo, setLockedTo] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [ownRateLabel, setOwnRateLabel] = React.useState<string | null>(null)

  // The pickers only load active contracts, so a suspended contract's line would
  // leave its own (read-only) field blank — the trip's own label is added back so
  // the record always shows what it is billed against.
  const rateLineOptions = React.useMemo(() => {
    const ownId = initial?.contractRouteId
    if (!ownId || !ownRateLabel) return loadedRateLineOptions
    if (loadedRateLineOptions.some((option) => option.value === ownId)) return loadedRateLineOptions
    return [...loadedRateLineOptions, { value: ownId, label: ownRateLabel }]
  }, [initial?.contractRouteId, loadedRateLineOptions, ownRateLabel])

  const fields = useTripFields(t, 'edit', rateLineOptions, orderOptions, vehicleOptions, driverOptions)
  const groups = useTripGroups(t)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<FreightTripRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          setInitial(toTripFormValues(item))
          setBillingStatus(item.billing_status)
          setLockedTo(item.active_abstract_id ?? null)
          setOwnRateLabel(`${item.origin} → ${item.destination}`)
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('freight_operations.trips.form.error.load', 'Could not load the trip.'))
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
    () => withFlash(LIST_HREF, t('freight_operations.trips.form.flash.saved', 'Trip saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('freight_operations.trips.form.flash.deleted', 'Trip deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('freight_operations.trips.form.error.notFound', 'Trip not found.')}
        backHref={LIST_HREF}
        backLabel={t('freight_operations.trips.actions.backToList', 'Back to trips')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  // A trip inside an abstract (or billed/excluded) refuses every write with
  // `trip_locked` — the record is healthy, only frozen, so it renders read-only
  // with the reason instead of an error state.
  const locked = billingStatus !== null && billingStatus !== 'unbilled'

  return (
    <CrudForm<TripFormValues>
      title={t('freight_operations.trips.form.edit.title', 'Edit trip')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildTripFormDefaults()}
      submitLabel={t('freight_operations.trips.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('freight_operations.trips.form.loading', 'Loading trip…')}
      readOnly={locked}
      readOnlyOverlay={locked ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
          {lockedTo
            ? t('freight_operations.trips.form.lockedInAbstract', 'This trip is part of an abstract and cannot be edited until that abstract is cancelled.')
            : t('freight_operations.trips.form.locked', 'This trip is locked because of its billing status.')}
        </div>
      ) : undefined}
      disableOptimisticLock={locked}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toTripPayload(values, 'edit', () => null) })
      }}
      onDelete={!locked ? async () => { await deleteCrud(RESOURCE, id) } : undefined}
    />
  )
}
