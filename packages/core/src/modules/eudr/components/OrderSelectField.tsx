"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  LookupSelectField,
  PICKER_PAGE_SIZE,
  type OrderSnapshot,
  type PickerOption,
  type Translator,
} from './formConfig'

type PickerPayload = {
  items?: unknown[]
}

type OrderSelectFieldProps = {
  id: string
  value?: string | null
  onChange: (value: string | undefined) => void
  onSnapshot?: (snapshot: OrderSnapshot | null) => void
  placeholder: string
  emptyLabel?: string
  loadError: string
  disabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function normalizeOrderOption(raw: unknown, translate: Translator): PickerOption<OrderSnapshot> | null {
  if (!isRecord(raw)) return null
  const id = readString(raw, ['id'])
  if (!id) return null
  const orderNumber = readString(raw, ['orderNumber', 'order_number'])
  const customerSnapshot = isRecord(raw.customerSnapshot)
    ? raw.customerSnapshot
    : (isRecord(raw.customer_snapshot) ? raw.customer_snapshot : null)
  const customer = customerSnapshot
    ? readString(customerSnapshot, ['displayName', 'display_name', 'name'])
    : null
  return {
    value: id,
    label: orderNumber ?? translate('eudr.common.recordUnavailable'),
    subtitle: customer,
    snapshot: { orderNumber: orderNumber ?? null },
  }
}

async function loadOrderPayload(url: string): Promise<PickerPayload> {
  const call = await apiCall<PickerPayload>(url, undefined, { fallback: { items: [] } })
  if (!call.ok) return { items: [] }
  return call.result ?? { items: [] }
}

export function OrderSelectField({
  id,
  value,
  onChange,
  onSnapshot,
  placeholder,
  loadError,
  disabled,
}: OrderSelectFieldProps) {
  const translate = useT()
  const loadOrderOptions = React.useCallback(async (search: string) => {
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(PICKER_PAGE_SIZE),
      sortField: 'number',
      sortDir: 'desc',
    })
    if (search) params.set('search', search)
    const payload = await loadOrderPayload(`/api/sales/orders?${params.toString()}`)
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeOrderOption(item, translate))
      .filter((option): option is PickerOption<OrderSnapshot> => option !== null)
  }, [translate])

  const loadSelectedOrder = React.useCallback(async (orderId: string) => {
    const payload = await loadOrderPayload(`/api/sales/orders?ids=${encodeURIComponent(orderId)}&pageSize=1`)
    const items = Array.isArray(payload.items) ? payload.items : []
    return items
      .map((item) => normalizeOrderOption(item, translate))
      .find((option): option is PickerOption<OrderSnapshot> => option?.value === orderId) ?? null
  }, [translate])

  return (
    <LookupSelectField
      id={id}
      value={value}
      onChange={onChange}
      onSnapshot={onSnapshot}
      placeholder={placeholder}
      loadError={loadError}
      disabled={disabled}
      loadOptions={loadOrderOptions}
      loadSelectedOption={loadSelectedOrder}
    />
  )
}

export default OrderSelectField
