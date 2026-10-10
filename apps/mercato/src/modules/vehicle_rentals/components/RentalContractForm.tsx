"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  useCustomerOptions,
  useTransportReference,
  type RentalCustomerSnapshot,
} from './rentalOptions'
import { LIST_HREF } from './rentalListMeta'
import {
  RENTAL_CLIENT_TYPE_FALLBACKS,
  RENTAL_CLIENT_TYPE_VALUES,
  RENTAL_DURATION_TYPE_FALLBACKS,
  RENTAL_DURATION_TYPE_VALUES,
  RENTAL_TYPE_FALLBACKS,
  RENTAL_TYPE_VALUES,
} from '../lib/rentalEnums'
import type { RentalContractRow } from './RentalContractsTable'

const ENTITY_ID = 'vehicle_rentals:rental_contract'
const RESOURCE = 'vehicle_rentals/contracts'

export type RentalFormValues = {
  id: string
  customerId: string
  rentalType: string
  clientType: string
  durationType: string
  vehicleId: string
  driverId: string
  startAt: string
  endAt: string
  dailyRate: string
  weeklyRate: string
  monthlyRate: string
  includedKm: string
  extraKmRate: string
  taxRate: string
  currencyCode: string
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

export function toRentalFormValues(row: RentalContractRow): RentalFormValues {
  const raw = row as unknown as Record<string, unknown>
  return {
    id: row.id,
    customerId: row.customer_id ?? '',
    rentalType: textOf(row.rental_type) || 'with_driver',
    clientType: textOf(row.client_type) || 'b2b',
    durationType: textOf(row.duration_type) || 'daily',
    vehicleId: textOf(row.vehicle_id),
    driverId: textOf(raw.driver_id),
    startAt: toDateTimeLocal(row.start_at),
    endAt: toDateTimeLocal(row.end_at),
    dailyRate: textOf(raw.daily_rate),
    weeklyRate: textOf(raw.weekly_rate),
    monthlyRate: textOf(raw.monthly_rate),
    includedKm: textOf(raw.included_km),
    extraKmRate: textOf(raw.extra_km_rate),
    taxRate: textOf(raw.tax_rate) || '15',
    currencyCode: textOf(row.currency_code) || 'SAR',
    notes: textOf(raw.notes),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildRentalFormDefaults(id = ''): RentalFormValues {
  const start = new Date()
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return {
    id,
    customerId: '',
    rentalType: 'with_driver',
    clientType: 'b2b',
    durationType: 'daily',
    vehicleId: '',
    driverId: '',
    startAt: toDateTimeLocal(start.toISOString()),
    endAt: toDateTimeLocal(end.toISOString()),
    dailyRate: '',
    weeklyRate: '',
    monthlyRate: '',
    includedKm: '',
    extraKmRate: '',
    taxRate: '15',
    currencyCode: 'SAR',
    notes: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

/**
 * The API requires the billing party's snapshot beside its id; the customer
 * picker is the only place that data exists on the client, so a submit without
 * it is refused with a field error rather than a raw validation failure.
 */
export function toRentalPayload(
  values: RentalFormValues,
  snapshot: RentalCustomerSnapshot | null,
  t: (key: string, fallback: string) => string,
): Record<string, unknown> {
  if (!snapshot) {
    throw createCrudFormError(t('vehicle_rentals.contracts.form.error.customerMissing', 'Choose a customer from the list.'))
  }
  return {
    customerId: values.customerId,
    customerSnapshot: snapshot,
    rentalType: values.rentalType || 'with_driver',
    clientType: values.clientType || 'b2b',
    durationType: values.durationType || 'daily',
    vehicleId: optional(values.vehicleId),
    driverId: optional(values.driverId),
    startAt: fromDateTimeLocal(values.startAt),
    endAt: fromDateTimeLocal(values.endAt),
    dailyRate: optional(values.dailyRate) ?? '0',
    weeklyRate: optional(values.weeklyRate) ?? '0',
    monthlyRate: optional(values.monthlyRate) ?? '0',
    includedKm: optional(values.includedKm),
    extraKmRate: optional(values.extraKmRate),
    taxRate: optional(values.taxRate) ?? '15',
    currencyCode: optional(values.currencyCode) ?? 'SAR',
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function useRentalFields(
  t: Translate,
  customerOptions: Array<{ value: string; label: string }>,
  vehicleOptions: Array<{ value: string; label: string }>,
  driverOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'customerId',
      label: t('vehicle_rentals.contracts.form.fields.customer', 'Customer'),
      type: 'select',
      required: true,
      options: customerOptions,
    },
    {
      id: 'rentalType',
      label: t('vehicle_rentals.contracts.form.fields.rentalType', 'Rental type'),
      type: 'select',
      layout: 'half',
      options: RENTAL_TYPE_VALUES.map((value) => ({
        value,
        label: t(`vehicle_rentals.rental_type.${value}`, RENTAL_TYPE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'clientType',
      label: t('vehicle_rentals.contracts.form.fields.clientType', 'Client type'),
      type: 'select',
      layout: 'half',
      options: RENTAL_CLIENT_TYPE_VALUES.map((value) => ({
        value,
        label: t(`vehicle_rentals.client_type.${value}`, RENTAL_CLIENT_TYPE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'durationType',
      label: t('vehicle_rentals.contracts.form.fields.durationType', 'Billing period'),
      type: 'select',
      layout: 'half',
      options: RENTAL_DURATION_TYPE_VALUES.map((value) => ({
        value,
        label: t(`vehicle_rentals.duration_type.${value}`, RENTAL_DURATION_TYPE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'vehicleId',
      label: t('vehicle_rentals.contracts.form.fields.vehicle', 'Vehicle'),
      type: 'select',
      layout: 'half',
      options: vehicleOptions,
    },
    {
      id: 'driverId',
      label: t('vehicle_rentals.contracts.form.fields.driver', 'Driver'),
      type: 'select',
      layout: 'half',
      options: driverOptions,
      visibleWhen: { field: 'rentalType', equals: 'with_driver' },
    },
    {
      id: 'startAt',
      label: t('vehicle_rentals.contracts.form.fields.startAt', 'Starts'),
      type: 'datetime-local',
      required: true,
      layout: 'half',
    },
    {
      id: 'endAt',
      label: t('vehicle_rentals.contracts.form.fields.endAt', 'Ends'),
      type: 'datetime-local',
      required: true,
      layout: 'half',
    },
    {
      id: 'dailyRate',
      label: t('vehicle_rentals.contracts.form.fields.dailyRate', 'Daily rate (net)'),
      type: 'number',
      layout: 'third',
      visibleWhen: { field: 'durationType', equals: 'daily' },
    },
    {
      id: 'weeklyRate',
      label: t('vehicle_rentals.contracts.form.fields.weeklyRate', 'Weekly rate (net)'),
      type: 'number',
      layout: 'third',
      visibleWhen: { field: 'durationType', equals: 'weekly' },
    },
    {
      id: 'monthlyRate',
      label: t('vehicle_rentals.contracts.form.fields.monthlyRate', 'Monthly rate (net)'),
      type: 'number',
      layout: 'third',
      visibleWhen: { field: 'durationType', equals: 'monthly' },
    },
    {
      id: 'includedKm',
      label: t('vehicle_rentals.contracts.form.fields.includedKm', 'Included km per period'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'extraKmRate',
      label: t('vehicle_rentals.contracts.form.fields.extraKmRate', 'Extra km rate (net)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'taxRate',
      label: t('vehicle_rentals.contracts.form.fields.taxRate', 'VAT rate (%)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'currencyCode',
      label: t('vehicle_rentals.contracts.form.fields.currency', 'Currency'),
      type: 'text',
      layout: 'third',
    },
    {
      id: 'notes',
      label: t('vehicle_rentals.contracts.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [customerOptions, driverOptions, t, vehicleOptions])
}

function useRentalGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'customer',
      title: t('vehicle_rentals.contracts.form.groups.customer', 'Customer'),
      column: 1,
      fields: ['customerId', 'rentalType', 'clientType', 'durationType'],
    },
    {
      id: 'assignment',
      title: t('vehicle_rentals.contracts.form.groups.assignment', 'Vehicle and driver'),
      column: 2,
      fields: ['vehicleId', 'driverId', 'startAt', 'endAt'],
    },
    {
      id: 'rates',
      title: t('vehicle_rentals.contracts.form.groups.rates', 'Rates and mileage'),
      column: 1,
      fields: ['dailyRate', 'weeklyRate', 'monthlyRate', 'includedKm', 'extraKmRate', 'taxRate', 'currencyCode'],
    },
    {
      id: 'notes',
      title: t('vehicle_rentals.contracts.form.groups.notes', 'Notes'),
      column: 2,
      fields: ['notes'],
    },
  ], [t])
}

export function RentalContractCreateForm() {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const { vehicleOptions, driverOptions } = useTransportReference()
  const fields = useRentalFields(t, customerOptions, vehicleOptions, driverOptions)
  const groups = useRentalGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('vehicle_rentals.contracts.form.flash.saved', 'Rental saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<RentalFormValues>
      title={t('vehicle_rentals.contracts.form.create.title', 'New rental contract')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildRentalFormDefaults()}
      submitLabel={t('vehicle_rentals.contracts.form.create.submit', 'Create rental')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toRentalPayload(values, toSnapshot(values.customerId), t))
      }}
    />
  )
}

export function RentalContractEditForm({ id }: { id: string }) {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const { vehicleOptions, driverOptions } = useTransportReference()
  const fields = useRentalFields(t, customerOptions, vehicleOptions, driverOptions)
  const groups = useRentalGroups(t)
  const [initial, setInitial] = React.useState<RentalFormValues | null>(null)
  const [lockedMessage, setLockedMessage] = React.useState<string | null>(null)
  const [deletable, setDeletable] = React.useState(false)
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
        const data = await fetchCrudList<RentalContractRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          setDeletable(item.status === 'draft')
          if (item.status === 'completed' || item.status === 'cancelled') {
            setLockedMessage(t('vehicle_rentals.contracts.form.error.closed', 'A closed rental cannot be edited.'))
          }
          setInitial(toRentalFormValues(item))
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('vehicle_rentals.contracts.form.error.load', 'Could not load the rental.'))
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
    () => withFlash(LIST_HREF, t('vehicle_rentals.contracts.form.flash.saved', 'Rental saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('vehicle_rentals.contracts.form.flash.deleted', 'Rental deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('vehicle_rentals.contracts.form.error.notFound', 'Rental not found.')}
        backHref={LIST_HREF}
        backLabel={t('vehicle_rentals.contracts.actions.backToList', 'Back to rentals')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  const locked = Boolean(lockedMessage)

  return (
    <CrudForm<RentalFormValues>
      title={t('vehicle_rentals.contracts.form.edit.title', 'Edit rental contract')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildRentalFormDefaults(id)}
      submitLabel={t('vehicle_rentals.contracts.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('vehicle_rentals.contracts.form.loading', 'Loading rental…')}
      readOnly={locked}
      readOnlyOverlay={lockedMessage ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">{lockedMessage}</div>
      ) : undefined}
      disableOptimisticLock={locked}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toRentalPayload(values, toSnapshot(values.customerId), t) })
      }}
      onDelete={deletable ? async () => { await deleteCrud(RESOURCE, id) } : undefined}
    />
  )
}
