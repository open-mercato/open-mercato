"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useCustomerOptions, type FreightCustomerSnapshot } from './freightOptions'
import type { FreightOrderRow } from './FreightOrdersTable'
import { LIST_HREF } from './orderListMeta'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'freight_operations:freight_order'
const RESOURCE = 'freight_operations/orders'

export const TRUCK_TYPE_VALUES = ['flatbed', 'curtain_side', 'refrigerated', 'tanker', 'tipper', 'lowbed', 'other'] as const
export const CARGO_UNIT_VALUES = ['trip', 'ton', 'kg', 'm3', 'pallet', 'container', 'other'] as const

export type OrderFormValues = {
  id: string
  customerId: string
  cargoDescription: string
  cargoWeightKg: string
  cargoVolumeM3: string
  cargoQuantity: string
  cargoUnit: string
  cargoHazardous: boolean
  cargoRefrigerated: boolean
  temperatureMinC: string
  temperatureMaxC: string
  pickupLocation: string
  dropoffLocation: string
  requestedPickupAt: string
  requestedDeliveryAt: string
  truckTypeRequired: string
  agreedAmountNet: string
  adjustmentAmountNet: string
  adjustmentNote: string
  vatRate: string
  currencyCode: string
  notes: string
  updatedAt?: string | null
}

/**
 * ISO instant → the `YYYY-MM-DDTHH:mm` a `datetime-local` input expects, in the
 * operator's own zone (the stored value is UTC; the input is wall-clock).
 */
export function toDateTimeLocal(value: string | null | undefined): string {
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

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export function toOrderFormValues(row: FreightOrderRow): OrderFormValues {
  return {
    id: row.id,
    customerId: row.customer_id ?? '',
    cargoDescription: textOf(row.cargo_description),
    cargoWeightKg: textOf((row as unknown as Record<string, unknown>).cargo_weight_kg),
    cargoVolumeM3: textOf((row as unknown as Record<string, unknown>).cargo_volume_m3),
    cargoQuantity: textOf((row as unknown as Record<string, unknown>).cargo_quantity),
    cargoUnit: textOf((row as unknown as Record<string, unknown>).cargo_unit),
    cargoHazardous: Boolean((row as unknown as Record<string, unknown>).cargo_hazardous),
    cargoRefrigerated: Boolean((row as unknown as Record<string, unknown>).cargo_refrigerated),
    temperatureMinC: textOf((row as unknown as Record<string, unknown>).temperature_min_c),
    temperatureMaxC: textOf((row as unknown as Record<string, unknown>).temperature_max_c),
    pickupLocation: textOf(row.pickup_location),
    dropoffLocation: textOf(row.dropoff_location),
    requestedPickupAt: toDateTimeLocal(row.requested_pickup_at),
    requestedDeliveryAt: toDateTimeLocal((row as unknown as Record<string, unknown>).requested_delivery_at as string | null),
    truckTypeRequired: textOf(row.truck_type_required) || 'other',
    agreedAmountNet: textOf(row.agreed_amount_net),
    adjustmentAmountNet: textOf(row.adjustment_amount_net),
    adjustmentNote: textOf((row as unknown as Record<string, unknown>).adjustment_note),
    vatRate: textOf((row as unknown as Record<string, unknown>).vat_rate) || '15',
    currencyCode: textOf(row.currency_code) || 'SAR',
    notes: textOf((row as unknown as Record<string, unknown>).notes),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildOrderFormDefaults(id = ''): OrderFormValues {
  return {
    id,
    customerId: '',
    cargoDescription: '',
    cargoWeightKg: '',
    cargoVolumeM3: '',
    cargoQuantity: '',
    cargoUnit: '',
    cargoHazardous: false,
    cargoRefrigerated: false,
    temperatureMinC: '',
    temperatureMaxC: '',
    pickupLocation: '',
    dropoffLocation: '',
    requestedPickupAt: '',
    requestedDeliveryAt: '',
    truckTypeRequired: 'other',
    agreedAmountNet: '',
    adjustmentAmountNet: '',
    adjustmentNote: '',
    vatRate: '15',
    currencyCode: 'SAR',
    notes: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

/**
 * The API requires the billing party's snapshot beside its id (that snapshot is
 * what the invoice keeps if the CRM record changes later). The picker is the
 * only place that data exists on the client, so a submit without it is refused
 * with a field-level error instead of a raw validation failure from the server.
 */
export function toOrderPayload(
  values: OrderFormValues,
  snapshot: FreightCustomerSnapshot | null,
  t: (key: string, fallback: string) => string,
): Record<string, unknown> {
  if (!snapshot) {
    throw createCrudFormError(t('freight_operations.orders.form.error.customerMissing', 'Choose a customer from the list.'))
  }
  const pickupAt = fromDateTimeLocal(values.requestedPickupAt)
  const deliveryAt = fromDateTimeLocal(values.requestedDeliveryAt)
  return {
    customerId: values.customerId,
    customerSnapshot: snapshot,
    cargoDescription: values.cargoDescription.trim(),
    cargoWeightKg: optional(values.cargoWeightKg),
    cargoVolumeM3: optional(values.cargoVolumeM3),
    cargoQuantity: optional(values.cargoQuantity),
    cargoUnit: optional(values.cargoUnit),
    cargoHazardous: values.cargoHazardous,
    cargoRefrigerated: values.cargoRefrigerated,
    temperatureMinC: values.cargoRefrigerated ? optional(values.temperatureMinC) : null,
    temperatureMaxC: values.cargoRefrigerated ? optional(values.temperatureMaxC) : null,
    pickupLocation: values.pickupLocation.trim(),
    dropoffLocation: values.dropoffLocation.trim(),
    ...(pickupAt ? { requestedPickupAt: pickupAt } : {}),
    ...(deliveryAt ? { requestedDeliveryAt: deliveryAt } : {}),
    truckTypeRequired: values.truckTypeRequired || 'other',
    agreedAmountNet: values.agreedAmountNet,
    adjustmentAmountNet: optional(values.adjustmentAmountNet),
    adjustmentNote: optional(values.adjustmentNote),
    vatRate: optional(values.vatRate) ?? '15',
    currencyCode: optional(values.currencyCode) ?? 'SAR',
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function useOrderFields(t: Translate, customerOptions: Array<{ value: string; label: string }>): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'customerId',
      label: t('freight_operations.orders.form.fields.customer', 'Customer'),
      type: 'select',
      required: true,
      options: customerOptions,
    },
    {
      id: 'cargoDescription',
      label: t('freight_operations.orders.form.fields.cargoDescription', 'Cargo description'),
      type: 'text',
      required: true,
    },
    {
      id: 'cargoWeightKg',
      label: t('freight_operations.orders.form.fields.cargoWeight', 'Cargo weight (kg)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'cargoVolumeM3',
      label: t('freight_operations.orders.form.fields.cargoVolume', 'Cargo volume (m³)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'cargoQuantity',
      label: t('freight_operations.orders.form.fields.cargoQuantity', 'Quantity'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'cargoUnit',
      label: t('freight_operations.orders.form.fields.cargoUnit', 'Quantity unit'),
      type: 'select',
      layout: 'third',
      options: CARGO_UNIT_VALUES.map((value) => ({
        value,
        label: t(`freight_operations.orders.cargo_unit.${value}`, value),
      })),
    },
    {
      id: 'cargoHazardous',
      label: t('freight_operations.orders.form.fields.cargoHazardous', 'Hazardous cargo'),
      type: 'checkbox',
      layout: 'third',
    },
    {
      id: 'cargoRefrigerated',
      label: t('freight_operations.orders.form.fields.cargoRefrigerated', 'Refrigerated cargo'),
      type: 'checkbox',
      layout: 'third',
    },
    {
      id: 'temperatureMinC',
      label: t('freight_operations.orders.form.fields.temperatureMin', 'Temperature min (°C)'),
      type: 'number',
      layout: 'third',
      visibleWhen: { field: 'cargoRefrigerated', equals: true },
    },
    {
      id: 'temperatureMaxC',
      label: t('freight_operations.orders.form.fields.temperatureMax', 'Temperature max (°C)'),
      type: 'number',
      layout: 'third',
      visibleWhen: { field: 'cargoRefrigerated', equals: true },
    },
    {
      id: 'pickupLocation',
      label: t('freight_operations.orders.form.fields.pickupLocation', 'Pickup location'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'dropoffLocation',
      label: t('freight_operations.orders.form.fields.dropoffLocation', 'Drop-off location'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'requestedPickupAt',
      label: t('freight_operations.orders.form.fields.requestedPickup', 'Requested pickup'),
      type: 'datetime-local',
      layout: 'half',
    },
    {
      id: 'requestedDeliveryAt',
      label: t('freight_operations.orders.form.fields.requestedDelivery', 'Requested delivery'),
      type: 'datetime-local',
      layout: 'half',
    },
    {
      id: 'truckTypeRequired',
      label: t('freight_operations.orders.form.fields.truckType', 'Truck type'),
      type: 'select',
      options: TRUCK_TYPE_VALUES.map((value) => ({
        value,
        label: t(`freight_operations.orders.truck_type.${value}`, value),
      })),
    },
    {
      id: 'agreedAmountNet',
      label: t('freight_operations.orders.form.fields.agreedAmount', 'Agreed amount (net, of VAT)'),
      type: 'number',
      required: true,
      layout: 'half',
    },
    {
      id: 'currencyCode',
      label: t('freight_operations.orders.form.fields.currency', 'Currency'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'adjustmentAmountNet',
      label: t('freight_operations.orders.form.fields.adjustment', 'Adjustment (signed, net)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'vatRate',
      label: t('freight_operations.orders.form.fields.vatRate', 'VAT rate (%)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'adjustmentNote',
      label: t('freight_operations.orders.form.fields.adjustmentNote', 'Adjustment note'),
      type: 'text',
    },
    {
      id: 'notes',
      label: t('freight_operations.orders.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [customerOptions, t])
}

function useOrderGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'customer',
      title: t('freight_operations.orders.form.groups.customer', 'Customer'),
      column: 1,
      fields: ['customerId'],
    },
    {
      id: 'cargo',
      title: t('freight_operations.orders.form.groups.cargo', 'Cargo'),
      column: 2,
      fields: [
        'cargoDescription', 'cargoWeightKg', 'cargoVolumeM3', 'cargoQuantity', 'cargoUnit',
        'cargoHazardous', 'cargoRefrigerated', 'temperatureMinC', 'temperatureMaxC',
      ],
    },
    {
      id: 'route',
      title: t('freight_operations.orders.form.groups.route', 'Route and schedule'),
      column: 1,
      fields: ['pickupLocation', 'dropoffLocation', 'requestedPickupAt', 'requestedDeliveryAt', 'truckTypeRequired'],
    },
    {
      id: 'pricing',
      title: t('freight_operations.orders.form.groups.pricing', 'Pricing'),
      column: 2,
      fields: ['agreedAmountNet', 'currencyCode', 'adjustmentAmountNet', 'vatRate', 'adjustmentNote'],
    },
    {
      id: 'notes',
      title: t('freight_operations.orders.form.groups.notes', 'Notes'),
      column: 1,
      fields: ['notes'],
    },
  ], [t])
}

export function OrderCreateForm() {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const fields = useOrderFields(t, customerOptions)
  const groups = useOrderGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('freight_operations.orders.form.flash.saved', 'Order saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<OrderFormValues>
      title={t('freight_operations.orders.form.create.title', 'New freight order')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildOrderFormDefaults()}
      submitLabel={t('freight_operations.orders.form.create.submit', 'Create order')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toOrderPayload(values, toSnapshot(values.customerId), t))
      }}
    />
  )
}

export function OrderEditForm({ id }: { id: string }) {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const fields = useOrderFields(t, customerOptions)
  const groups = useOrderGroups(t)
  const [initial, setInitial] = React.useState<OrderFormValues | null>(null)
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
        const data = await fetchCrudList<FreightOrderRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toOrderFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('freight_operations.orders.form.error.load', 'Could not load the order.'))
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
    () => withFlash(LIST_HREF, t('freight_operations.orders.form.flash.saved', 'Order saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('freight_operations.orders.form.flash.deleted', 'Order deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('freight_operations.orders.form.error.notFound', 'Order not found.')}
        backHref={LIST_HREF}
        backLabel={t('freight_operations.orders.actions.backToList', 'Back to orders')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<OrderFormValues>
      title={t('freight_operations.orders.form.edit.title', 'Edit freight order')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildOrderFormDefaults(id)}
      submitLabel={t('freight_operations.orders.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('freight_operations.orders.form.loading', 'Loading order…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toOrderPayload(values, toSnapshot(values.customerId), t) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
