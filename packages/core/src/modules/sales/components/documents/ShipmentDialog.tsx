"use client"

import * as React from 'react'
import { MapPin, Truck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { cn } from '@open-mercato/shared/lib/utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { emitSalesDocumentTotalsRefresh } from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import { useT } from '@/lib/i18n/context'
import { formatMoney, normalizeNumber } from './lineItemUtils'
import type { OrderLine, ShipmentRow } from './shipmentTypes'
import { formatAddressString, type AddressFormatStrategy, type AddressValue } from '@open-mercato/core/modules/customers/utils/addressFormat'

type ShippingMethodOption = {
  id: string
  name: string
  code: string
  currencyCode: string | null
  baseRateNet: number | null
  baseRateGross: number | null
  minPrice: number | null
  avgPrice: number | null
}

type ShipmentDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  shipment: ShipmentRow | null
  lines: OrderLine[]
  orderId: string
  currencyCode?: string | null
  organizationId: string | null
  tenantId: string | null
  computeAvailable: (lineId: string, excludeShipmentId?: string | null) => number
  shippingAddressSnapshot?: NormalizedAddressSnapshot | Record<string, unknown> | null
  onClose: () => void
  onSaved: () => Promise<void>
  onAddComment?: (body: string) => Promise<void>
}

type ShipmentAddressOption = {
  id: string
  label: string
  summary: string
  snapshot: NormalizedAddressSnapshot
}

type StatusOption = {
  id: string
  value: string
  label: string
  color: string | null
}

const ADDRESS_SNAPSHOT_KEY = 'shipmentAddressSnapshot'
const ADDRESS_FORMAT: AddressFormatStrategy = 'line_first'
const SHIPPING_ADJUSTMENT_TOGGLE_ID = 'shipment-add-shipping-adjustment'
const SHIPPING_ADJUSTMENT_LABEL_ID = 'shipment-add-shipping-adjustment-label'
const SHIPPING_ADJUSTMENT_HELP_ID = 'shipment-add-shipping-adjustment-help'

type NormalizedAddressSnapshot = {
  id?: string
  documentAddressId?: string
  name?: string
  purpose?: string
  companyName?: string
  addressLine1?: string
  addressLine2?: string
  buildingNumber?: string
  flatNumber?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  latitude?: number
  longitude?: number
  isPrimary?: boolean
  [key: string]: string | number | boolean | null | undefined
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== undefined)
  if (value === undefined) return null
  return value
}

const prefixCustomFieldValues = (input?: Record<string, unknown> | null): Record<string, unknown> => {
  if (!input || typeof input !== 'object') return {}
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalized = key.startsWith('cf_') ? key : `cf_${key}`
    acc[normalized] = value
    return acc
  }, {})
}

const parseTrackingNumbers = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

const normalizePrice = (value: unknown): number | null => {
  const parsed = normalizeNumber(value, NaN)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0) return null
  return parsed
}

const roundAmount = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100

const readStringField = (input: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length) return value.trim()
  }
  return null
}

const normalizeAddressSnapshot = (
  input?: Record<string, unknown> | null,
): NormalizedAddressSnapshot | null => {
  if (!input || typeof input !== 'object') return null
  const normalized: NormalizedAddressSnapshot = {}
  const assignString = (target: string, ...sourceKeys: string[]) => {
    const value = readStringField(input as Record<string, unknown>, sourceKeys)
    if (value) normalized[target] = value
  }
  const assignOther = (target: string, value: unknown) => {
    if (typeof value === 'boolean') {
      normalized[target] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[target] = value
    }
  }

  const id =
    readStringField(input as Record<string, unknown>, ['customerAddressId', 'customer_address_id']) ??
    readStringField(input as Record<string, unknown>, ['id'])
  if (id) normalized.id = id
  const documentAddressId = readStringField(input as Record<string, unknown>, ['documentAddressId', 'document_address_id'])
  if (documentAddressId && documentAddressId !== id) normalized.documentAddressId = documentAddressId

  assignString('name', 'name')
  assignString('purpose', 'purpose')
  assignString('companyName', 'companyName', 'company_name')
  assignString('addressLine1', 'addressLine1', 'address_line1')
  assignString('addressLine2', 'addressLine2', 'address_line2')
  assignString('buildingNumber', 'buildingNumber', 'building_number')
  assignString('flatNumber', 'flatNumber', 'flat_number')
  assignString('city', 'city')
  assignString('region', 'region')
  assignString('postalCode', 'postalCode', 'postal_code')
  assignString('country', 'country')
  assignOther('latitude', (input as any).latitude ?? null)
  assignOther('longitude', (input as any).longitude ?? null)
  assignOther('isPrimary', (input as any).isPrimary ?? (input as any).is_primary ?? false)

  return Object.keys(normalized).length ? normalized : null
}

const mapSnapshotToAddressValue = (snapshot: NormalizedAddressSnapshot): AddressValue => ({
  addressLine1: readStringField(snapshot, ['addressLine1']),
  addressLine2: readStringField(snapshot, ['addressLine2']),
  buildingNumber: readStringField(snapshot, ['buildingNumber']),
  flatNumber: readStringField(snapshot, ['flatNumber']),
  city: readStringField(snapshot, ['city']),
  region: readStringField(snapshot, ['region']),
  postalCode: readStringField(snapshot, ['postalCode']),
  country: readStringField(snapshot, ['country']),
  companyName: readStringField(snapshot, ['companyName']),
})

const snapshotKey = (snapshot?: NormalizedAddressSnapshot | null): string | null => {
  if (!snapshot || typeof snapshot !== 'object') return null
  const normalized: Record<string, unknown> = {}
  Object.keys(snapshot)
    .sort()
    .forEach((key) => {
      normalized[key] = snapshot[key]
  })
  return JSON.stringify(normalized)
}

const fallbackAddressId = (id?: string): string => id ?? 'address'

const buildAddressOption = (
  snapshot?: NormalizedAddressSnapshot | Record<string, unknown> | null,
  opts?: { id?: string; label?: string },
): ShipmentAddressOption | null => {
  const normalized = normalizeAddressSnapshot(snapshot)
  if (!normalized) return null
  const value = mapSnapshotToAddressValue(normalized)
  const summary = formatAddressString(value, ADDRESS_FORMAT)
  const label: string =
    (opts?.label ?? normalized.name ?? normalized.purpose ?? summary ?? normalized.companyName) ??
    fallbackAddressId(opts?.id)
  const normalizedId =
    (typeof normalized.documentAddressId === 'string' && normalized.documentAddressId) ||
    (typeof normalized.id === 'string' && normalized.id) ||
    null
  const id = opts?.id ?? normalizedId ?? fallbackAddressId(opts?.id)
  return {
    id,
    label: label || id,
    summary: summary || label || id,
    snapshot: normalized,
  }
}

const dedupeAddressOptions = (options: ShipmentAddressOption[]): ShipmentAddressOption[] => {
  const seen = new Set<string>()
  return options.reduce<ShipmentAddressOption[]>((acc, option) => {
    const key = snapshotKey(option.snapshot) ?? option.id
    if (seen.has(key)) return acc
    seen.add(key)
    acc.push(option)
    return acc
  }, [])
}

const extractShipmentAddressSnapshot = (
  metadata?: Record<string, unknown> | null,
): NormalizedAddressSnapshot | null => {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as any)[ADDRESS_SNAPSHOT_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return normalizeAddressSnapshot(raw as Record<string, unknown>)
}

export function ShipmentDialog({
  open,
  mode,
  shipment,
  lines,
  orderId,
  currencyCode,
  organizationId,
  tenantId,
  computeAvailable,
  shippingAddressSnapshot,
  onClose,
  onSaved,
  onAddComment,
}: ShipmentDialogProps) {
  const t = useT()
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [shippingMethods, setShippingMethods] = React.useState<ShippingMethodOption[]>([])
  const [shippingMethodLoading, setShippingMethodLoading] = React.useState(false)
  const [addressOptions, setAddressOptions] = React.useState<ShipmentAddressOption[]>([])
  const [addressLoading, setAddressLoading] = React.useState(false)
  const [addressError, setAddressError] = React.useState<string | null>(null)
  const [documentStatuses, setDocumentStatuses] = React.useState<StatusOption[]>([])
  const [lineStatuses, setLineStatuses] = React.useState<StatusOption[]>([])
  const [shipmentStatuses, setShipmentStatuses] = React.useState<StatusOption[]>([])
  const [documentStatusLoading, setDocumentStatusLoading] = React.useState(false)
  const [lineStatusLoading, setLineStatusLoading] = React.useState(false)
  const [shipmentStatusLoading, setShipmentStatusLoading] = React.useState(false)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const itemErrorSetterRef = React.useRef<((errors: Record<string, string | undefined>) => void) | null>(null)

  const baseItems = React.useMemo(
    () =>
      lines.reduce<Record<string, string>>((acc, line) => {
        acc[line.id] = ''
        return acc
      }, {}),
    [lines],
  )

  const shipmentAddressSnapshot = React.useMemo(
    () => extractShipmentAddressSnapshot(shipment?.metadata),
    [shipment?.metadata],
  )

  const normalizedShippingAddressSnapshot = React.useMemo(
    () => normalizeAddressSnapshot(shippingAddressSnapshot ?? null),
    [shippingAddressSnapshot],
  )

  const shippingAddressOption = React.useMemo(
    () =>
      buildAddressOption(normalizedShippingAddressSnapshot ?? null, {
        id: 'shipping-address',
        label: t('sales.documents.shipments.shippingAddressLabel', 'Shipping address'),
      }),
    [normalizedShippingAddressSnapshot, t],
  )

  const shipmentAddressOption = React.useMemo(
    () =>
      buildAddressOption(shipmentAddressSnapshot ?? null, {
        id: 'shipment-address',
        label: t('sales.documents.shipments.shipmentAddressLabel', 'Shipment address'),
      }),
    [shipmentAddressSnapshot, t],
  )

  const baseAddressOptions = React.useMemo(
    () =>
      dedupeAddressOptions(
        [shippingAddressOption, shipmentAddressOption].filter(
          (entry): entry is ShipmentAddressOption => Boolean(entry),
        ),
      ),
    [shipmentAddressOption, shippingAddressOption],
  )

  const preferredAddressId = React.useMemo(() => {
    const shipmentKey = snapshotKey(shipmentAddressSnapshot)
    if (shipmentKey) {
      const match = baseAddressOptions.find(
        (option) => snapshotKey(option.snapshot) === shipmentKey
      )
      if (match) return match.id
    }
    if (normalizedShippingAddressSnapshot) {
      const shippingKey = snapshotKey(normalizedShippingAddressSnapshot)
      const match = baseAddressOptions.find(
        (option) => snapshotKey(option.snapshot) === shippingKey
      )
      if (match) return match.id
    }
    return baseAddressOptions[0]?.id ?? ''
  }, [baseAddressOptions, shipmentAddressSnapshot, normalizedShippingAddressSnapshot])

  const initialValues = React.useMemo(
    () => ({
      shipmentNumber: shipment?.shipmentNumber ?? '',
      carrierName: shipment?.carrierName ?? '',
      shippingMethodId: shipment?.shippingMethodId ?? '',
      shipmentAddressId: preferredAddressId,
      shippedAt: shipment?.shippedAt ? shipment.shippedAt.slice(0, 10) : '',
      deliveredAt: shipment?.deliveredAt ? shipment.deliveredAt.slice(0, 10) : '',
      trackingNumbers: shipment?.trackingNumbers?.join('\n') ?? '',
      notes: shipment?.notes ?? '',
      statusEntryId: shipment?.statusEntryId ?? '',
      documentStatusEntryId: '',
      lineStatusEntryId: '',
      postComment: true,
      addShippingAdjustment: !shipment,
      items: lines.reduce<Record<string, string>>((acc, line) => {
        const found = shipment?.items.find((item) => item.orderLineId === line.id)
        acc[line.id] = found ? String(found.quantity) : ''
        return acc
      }, baseItems),
      ...prefixCustomFieldValues(shipment?.customValues ?? null),
    }),
    [
      baseItems,
      lines,
      mode,
      preferredAddressId,
      shipment?.carrierName,
      shipment?.customValues,
      shipment?.deliveredAt,
      shipment?.items,
      shipment?.metadata,
      shipment?.notes,
      shipment?.shipmentNumber,
      shipment?.shippedAt,
      shipment?.shippingMethodId,
      shipment?.statusEntryId,
      shipment?.trackingNumbers,
      shippingAddressSnapshot,
      shipmentAddressSnapshot,
    ],
  )

  const addressOptionsMap = React.useMemo(() => {
    const map = new Map<string, ShipmentAddressOption>()
    addressOptions.forEach((option) => map.set(option.id, option))
    return map
  }, [addressOptions])

  const registerItemErrors = React.useCallback((updater: (errors: Record<string, string | undefined>) => void) => {
    itemErrorSetterRef.current = updater
  }, [])

  const clearItemErrors = React.useCallback(() => {
    itemErrorSetterRef.current?.({})
  }, [])

  const ensureShippingMethodOption = React.useCallback(
    (option: ShippingMethodOption | null) => {
      if (!option) return
      setShippingMethods((prev) => {
        if (prev.some((entry) => entry.id === option.id)) return prev
        return [...prev, option]
      })
    },
    [],
  )

  const mapDocumentAddressOption = React.useCallback(
    (item: Record<string, unknown>): ShipmentAddressOption | null => {
      const snapshot = normalizeAddressSnapshot({
        documentAddressId: readStringField(item, ['id']),
        customerAddressId: readStringField(item, ['customer_address_id', 'customerAddressId']),
        name: readStringField(item, ['name']),
        purpose: readStringField(item, ['purpose']),
        companyName: readStringField(item, ['company_name', 'companyName']),
        addressLine1: readStringField(item, ['address_line1', 'addressLine1']),
        addressLine2: readStringField(item, ['address_line2', 'addressLine2']),
        buildingNumber: readStringField(item, ['building_number', 'buildingNumber']),
        flatNumber: readStringField(item, ['flat_number', 'flatNumber']),
        city: readStringField(item, ['city']),
        region: readStringField(item, ['region']),
        postalCode: readStringField(item, ['postal_code', 'postalCode']),
        country: readStringField(item, ['country']),
      })
      if (!snapshot) return null
      const label =
        snapshot.name ??
        snapshot.purpose ??
        t('sales.documents.shipments.addressFallback', 'Document address')
      const id =
        readStringField(item, ['id']) ??
        readStringField(item, ['customer_address_id', 'customerAddressId']) ??
        undefined
      return buildAddressOption(snapshot, { id, label })
    },
    [t],
  )

  const mergeAddressOptions = React.useCallback(
    (options: ShipmentAddressOption[]) =>
      setAddressOptions((prev) => dedupeAddressOptions([...prev, ...options])),
    [],
  )

  const loadAddressOptions = React.useCallback(async () => {
    setAddressLoading(true)
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '100',
        documentId: orderId,
        documentKind: 'order',
      })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/document-addresses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped = items
        .map((item) => mapDocumentAddressOption(item))
        .filter((entry): entry is ShipmentAddressOption => Boolean(entry))
      mergeAddressOptions(mapped)
      setAddressError(null)
      return mapped
    } catch (err) {
      console.error('sales.shipments.addresses.load', err)
      setAddressError(
        t('sales.documents.shipments.addressLoadError', 'Failed to load addresses.'),
      )
      return []
    } finally {
      setAddressLoading(false)
    }
  }, [mapDocumentAddressOption, mergeAddressOptions, orderId, t])

  const buildPriceSubtitle = React.useCallback(
    (option: ShippingMethodOption): string | undefined => {
      const currency = option.currencyCode ?? currencyCode ?? undefined
      const parts: string[] = []
      if (option.avgPrice !== null) {
        parts.push(
          t('sales.documents.shipments.shippingMethodAvg', 'Avg {{price}}', {
            price: formatMoney(option.avgPrice, currency ?? null),
          }),
        )
      }
      if (option.minPrice !== null) {
        parts.push(
          t('sales.documents.shipments.shippingMethodMin', 'Min {{price}}', {
            price: formatMoney(option.minPrice, currency ?? null),
          }),
        )
      }
      if (parts.length === 0) return undefined
      return parts.join(' · ')
    },
    [currencyCode, t],
  )

  const mapShippingMethod = React.useCallback(
    (item: Record<string, unknown>): ShippingMethodOption | null => {
      const id = typeof item.id === 'string' ? item.id : null
      const name = typeof item.name === 'string' ? item.name : null
      const code = typeof (item as any).code === 'string' ? (item as any).code : null
      if (!id || !name) return null
      const baseRateNet = normalizePrice((item as any).baseRateNet ?? (item as any).base_rate_net)
      const baseRateGross = normalizePrice((item as any).baseRateGross ?? (item as any).base_rate_gross)
      const prices = [baseRateNet, baseRateGross].filter((value): value is number => Number.isFinite(value))
      const minPrice = prices.length ? Math.min(...prices) : null
      const avgPrice = prices.length ? prices.reduce((acc, value) => acc + value, 0) / prices.length : null
      return {
        id,
        name,
        code: code ?? id,
        currencyCode: typeof (item as any).currencyCode === 'string' ? (item as any).currencyCode : null,
        baseRateNet,
        baseRateGross,
        minPrice,
        avgPrice,
      }
    },
    [],
  )

  const loadShippingMethods = React.useCallback(
    async (query?: string, opts?: { applyLoadingState?: boolean }): Promise<ShippingMethodOption[]> => {
      const applyLoadingState = opts?.applyLoadingState !== false
      if (applyLoadingState) setShippingMethodLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '50' })
        if (query && query.trim().length) params.set('search', query.trim())
        const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/sales/shipping-methods?${params.toString()}`,
          undefined,
          { fallback: { items: [] } },
        )
        const items = Array.isArray(response.result?.items) ? response.result.items : []
        const options = items
          .map((item) => mapShippingMethod(item))
          .filter((entry): entry is ShippingMethodOption => !!entry)
        if (!query) {
          setShippingMethods(options)
        }
        return options
      } catch (err) {
        console.error('sales.shipments.shipping-methods.load', err)
        return []
      } finally {
        if (applyLoadingState) setShippingMethodLoading(false)
      }
    },
    [mapShippingMethod],
  )

  const fetchShippingMethodItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      if (!query || !query.trim()) {
        const options =
          shippingMethods.length > 0
            ? shippingMethods
            : await loadShippingMethods(undefined, { applyLoadingState: true })
        return options.map((option) => ({
          id: option.id,
          title: option.name,
          subtitle: [option.code, buildPriceSubtitle(option)].filter(Boolean).join(' • ') || undefined,
          icon: (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Truck className="h-4 w-4" />
            </div>
          ),
        }))
      }

      const options = await loadShippingMethods(query, { applyLoadingState: false })
      const needle = query?.trim().toLowerCase() ?? ''
      const filtered = options.filter(
        (opt) =>
          !needle ||
          opt.name.toLowerCase().includes(needle) ||
          opt.code.toLowerCase().includes(needle),
      )
      return filtered.map((option) => ({
        id: option.id,
        title: option.name,
        subtitle: [option.code, buildPriceSubtitle(option)].filter(Boolean).join(' • ') || undefined,
        icon: (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Truck className="h-4 w-4" />
          </div>
        ),
      }))
    },
    [buildPriceSubtitle, loadShippingMethods, shippingMethods],
  )

  const renderStatusIcon = React.useCallback(
    (color?: string | null) => (
      <span
        className="h-2.5 w-2.5 rounded-full border border-border/70"
        style={color ? { backgroundColor: color, borderColor: color } : undefined}
      />
    ),
    [],
  )

  const loadDocumentStatuses = React.useCallback(async (): Promise<StatusOption[]> => {
    setDocumentStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/order-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped = items
        .map((entry) => {
          const id = typeof entry.id === 'string' ? entry.id : null
          const value = typeof entry.value === 'string' ? entry.value : null
          if (!id || !value) return null
          const label =
            typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label
              : value
          const color =
            typeof entry.color === 'string' && entry.color.trim().length ? entry.color : null
          return { id, value, label, color }
        })
        .filter((entry): entry is StatusOption => Boolean(entry))
      setDocumentStatuses(mapped)
      return mapped
    } catch (err) {
      console.error('sales.shipments.statuses.load', err)
      setDocumentStatuses([])
      return []
    } finally {
      setDocumentStatusLoading(false)
    }
  }, [])

  const loadLineStatuses = React.useCallback(async (): Promise<StatusOption[]> => {
    setLineStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/order-line-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped = items
        .map((entry) => {
          const id = typeof entry.id === 'string' ? entry.id : null
          const value = typeof entry.value === 'string' ? entry.value : null
          if (!id || !value) return null
          const label =
            typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label
              : value
          const color =
            typeof entry.color === 'string' && entry.color.trim().length ? entry.color : null
          return { id, value, label, color }
        })
        .filter((entry): entry is StatusOption => Boolean(entry))
      setLineStatuses(mapped)
      return mapped
    } catch (err) {
      console.error('sales.shipments.line-statuses.load', err)
      setLineStatuses([])
      return []
    } finally {
      setLineStatusLoading(false)
    }
  }, [])

  const loadShipmentStatuses = React.useCallback(async (): Promise<StatusOption[]> => {
    setShipmentStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/shipment-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped = items
        .map((entry) => {
          const id = typeof entry.id === 'string' ? entry.id : null
          const value = typeof entry.value === 'string' ? entry.value : null
          if (!id || !value) return null
          const label =
            typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label
              : value
          const color =
            typeof entry.color === 'string' && entry.color.trim().length ? entry.color : null
          return { id, value, label, color }
        })
        .filter((entry): entry is StatusOption => Boolean(entry))
      setShipmentStatuses(mapped)
      return mapped
    } catch (err) {
      console.error('sales.shipments.statuses.load', err)
      setShipmentStatuses([])
      return []
    } finally {
      setShipmentStatusLoading(false)
    }
  }, [])

  const fetchDocumentStatusItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options =
        documentStatuses.length && !query ? documentStatuses : await loadDocumentStatuses()
      const term = query?.trim().toLowerCase() ?? ''
      return options
        .filter(
          (option) =>
            !term.length ||
            option.label.toLowerCase().includes(term) ||
            option.value.toLowerCase().includes(term),
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.value,
          icon: renderStatusIcon(option.color),
        }))
    },
    [documentStatuses, loadDocumentStatuses, renderStatusIcon],
  )

  const fetchLineStatusItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options = lineStatuses.length && !query ? lineStatuses : await loadLineStatuses()
      const term = query?.trim().toLowerCase() ?? ''
      return options
        .filter(
          (option) =>
            !term.length ||
            option.label.toLowerCase().includes(term) ||
            option.value.toLowerCase().includes(term),
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.value,
          icon: renderStatusIcon(option.color),
        }))
    },
    [lineStatuses, loadLineStatuses, renderStatusIcon],
  )

  const fetchShipmentStatusItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options =
        shipmentStatuses.length && !query ? shipmentStatuses : await loadShipmentStatuses()
      const term = query?.trim().toLowerCase() ?? ''
      return options
        .filter(
          (option) =>
            !term.length ||
            option.label.toLowerCase().includes(term) ||
            option.value.toLowerCase().includes(term),
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.value,
          icon: renderStatusIcon(option.color),
        }))
    },
    [loadShipmentStatuses, renderStatusIcon, shipmentStatuses],
  )

  React.useEffect(() => {
    if (!open) return
    setFormResetKey((prev) => prev + 1)
    if (!shippingMethods.length) {
      void loadShippingMethods()
    }
    setAddressOptions(baseAddressOptions)
    setAddressError(null)
    if (!addressOptions.length) {
      void loadAddressOptions()
    }
    if (!shipmentStatuses.length) {
      void loadShipmentStatuses()
    }
    if (!documentStatuses.length && mode === 'create') {
      void loadDocumentStatuses()
    }
    if (!lineStatuses.length && mode === 'create') {
      void loadLineStatuses()
    }
  }, [
    addressOptions.length,
    baseAddressOptions,
    documentStatuses.length,
    loadAddressOptions,
    loadDocumentStatuses,
    loadShipmentStatuses,
    loadLineStatuses,
    loadShippingMethods,
    mode,
    open,
    lineStatuses.length,
    shipmentStatuses.length,
    shippingMethods.length,
  ])

  React.useEffect(() => {
    if (shipment?.shippingMethodId) {
      ensureShippingMethodOption(
        mapShippingMethod({
          id: shipment.shippingMethodId,
          name: shipment.shippingMethodName ?? shipment.shippingMethodCode ?? shipment.shippingMethodId,
          code: shipment.shippingMethodCode ?? shipment.shippingMethodId,
          currencyCode: currencyCode ?? null,
        }),
      )
    }
  }, [
    currencyCode,
    ensureShippingMethodOption,
    mapShippingMethod,
    shipment?.shippingMethodCode,
    shipment?.shippingMethodId,
    shipment?.shippingMethodName,
  ])

  React.useEffect(() => {
    if (!open) return
    mergeAddressOptions(baseAddressOptions)
  }, [baseAddressOptions, mergeAddressOptions, open])

  const fetchAddressItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      if (!addressOptions.length && !addressLoading) {
        await loadAddressOptions()
      }
      const needle = query?.trim().toLowerCase() ?? ''
      return addressOptions
        .filter((option) => {
          if (!needle) return true
          return (
            option.label.toLowerCase().includes(needle) ||
            option.summary.toLowerCase().includes(needle)
          )
        })
        .map((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.summary,
          icon: (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <MapPin className="h-4 w-4" />
            </div>
          ),
        }))
    },
    [addressLoading, addressOptions, loadAddressOptions],
  )

  const validateItems = React.useCallback(
    (itemsValue: unknown) => {
      const entries = Object.entries((itemsValue ?? {}) as Record<string, unknown>)
        .map(([lineId, value]) => ({ lineId, quantity: Number(value) }))
        .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
      if (!entries.length) {
        clearItemErrors()
        throw createCrudFormError(
          t('sales.documents.shipments.errorItems', 'Ship at least one line item.'),
          { items: t('sales.documents.shipments.errorItems', 'Ship at least one line item.') },
        )
      }
      const errors: Record<string, string> = {}
      entries.forEach((entry) => {
        const available = computeAvailable(entry.lineId, shipment?.id ?? null)
        if (entry.quantity > available + 1e-6) {
          errors[entry.lineId] = t('sales.documents.shipments.errorQuantity', 'Quantity exceeds remaining available.')
        }
      })
      if (Object.keys(errors).length) {
        itemErrorSetterRef.current?.(errors)
        throw createCrudFormError(
          t('sales.documents.shipments.errorQuantity', 'Quantity exceeds remaining available.'),
          { items: t('sales.documents.shipments.errorQuantity', 'Quantity exceeds remaining available.') },
        )
      }
      clearItemErrors()
      return entries
    },
    [clearItemErrors, computeAvailable, shipment?.id, t],
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const shipmentNumber =
        typeof values.shipmentNumber === 'string' ? values.shipmentNumber.trim() : ''
      if (!shipmentNumber.length) {
        throw createCrudFormError(
          t('sales.documents.shipments.errorNumber', 'Shipment number is required.'),
          { shipmentNumber: t('sales.documents.shipments.errorNumber', 'Shipment number is required.') },
        )
      }
      const shippingMethodId =
        typeof values.shippingMethodId === 'string' && values.shippingMethodId.trim().length
          ? values.shippingMethodId
          : ''
      if (!shippingMethodId) {
        throw createCrudFormError(
          t('sales.documents.shipments.errorShippingMethod', 'Select a shipping method.'),
          { shippingMethodId: t('sales.documents.shipments.errorShippingMethod', 'Select a shipping method.') },
        )
      }
      const items = validateItems(values.items)
      const shipmentAddressId =
        typeof values.shipmentAddressId === 'string' ? values.shipmentAddressId : ''
      const addressOption = shipmentAddressId
        ? addressOptionsMap.get(shipmentAddressId) ?? null
        : null
      const fallbackAddress = addressOptions.length === 1 ? addressOptions[0] : null
      const addressSnapshot = addressOption?.snapshot ?? fallbackAddress?.snapshot ?? null
      if (!addressSnapshot) {
        const message = addressOptions.length
          ? t('sales.documents.shipments.errorAddress', 'Select an address to ship to.')
          : t(
              'sales.documents.shipments.addressMissing',
              'Add an address to this document before creating a shipment.',
            )
        throw createCrudFormError(message, { shipmentAddressId: message })
      }
      const payload: Record<string, unknown> = {
        orderId,
        organizationId: organizationId ?? undefined,
        tenantId: tenantId ?? undefined,
        shipmentNumber,
        shippingMethodId,
        statusEntryId:
          typeof values.statusEntryId === 'string' && values.statusEntryId.trim().length
            ? values.statusEntryId
            : undefined,
        carrierName:
          typeof values.carrierName === 'string' && values.carrierName.trim().length
            ? values.carrierName.trim()
            : undefined,
        trackingNumbers: parseTrackingNumbers(
          typeof values.trackingNumbers === 'string' ? values.trackingNumbers : '',
        ),
        shippedAt:
          typeof values.shippedAt === 'string' && values.shippedAt.trim().length
            ? new Date(values.shippedAt)
            : undefined,
        deliveredAt:
          typeof values.deliveredAt === 'string' && values.deliveredAt.trim().length
            ? new Date(values.deliveredAt)
            : undefined,
        notes:
          typeof values.notes === 'string' && values.notes.trim().length
            ? values.notes.trim()
            : undefined,
        items: items.map((item) => ({
          orderLineId: item.lineId,
          quantity: item.quantity,
        })),
      }
      payload.shipmentAddressSnapshot = addressSnapshot
      const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
      if (Object.keys(customFields).length) {
        payload.customFields = customFields
      }
      if (mode === 'create') {
        const documentStatusEntryId =
          typeof values.documentStatusEntryId === 'string' && values.documentStatusEntryId.trim().length
            ? values.documentStatusEntryId
            : null
        const lineStatusEntryId =
          typeof values.lineStatusEntryId === 'string' && values.lineStatusEntryId.trim().length
            ? values.lineStatusEntryId
            : null
        if (documentStatusEntryId) {
          payload.documentStatusEntryId = documentStatusEntryId
        }
        if (lineStatusEntryId) {
          payload.lineStatusEntryId = lineStatusEntryId
        }
      }

      const action = shipment?.id ? updateCrud : createCrud
      const result = await action(
        'sales/shipments',
        shipment?.id ? { id: shipment.id, ...payload } : payload,
        {
          errorMessage: t('sales.documents.shipments.errorSave', 'Failed to save shipment.'),
        },
      )
      if (result.ok) {
        const shipmentId = ((result.result as any)?.id as string | undefined) ?? shipment?.id ?? null
        const shouldAddShippingAdjustment =
          mode === 'create' &&
          Boolean(values.addShippingAdjustment) &&
          shipmentId
        if (shouldAddShippingAdjustment) {
          const method = shippingMethods.find((entry) => entry.id === shippingMethodId) ?? null
          const totalQuantity = items.reduce((acc, item) => acc + item.quantity, 0)
          const unitGross =
            method?.baseRateGross ??
            method?.avgPrice ??
            method?.minPrice ??
            (method?.baseRateNet ?? null)
          const unitNet = method?.baseRateNet ?? null
          const amountGross =
            typeof unitGross === 'number' && Number.isFinite(unitGross) && totalQuantity > 0
              ? roundAmount(Math.max(unitGross * totalQuantity, 0))
              : null
          const amountNet =
            typeof unitNet === 'number' && Number.isFinite(unitNet) && totalQuantity > 0
              ? roundAmount(Math.max(unitNet * totalQuantity, 0))
              : null
          const currency =
            typeof method?.currencyCode === 'string' && method.currencyCode.trim().length
              ? method.currencyCode.trim().toUpperCase()
            : typeof currencyCode === 'string' && currencyCode.trim().length
                ? currencyCode.trim().toUpperCase()
                : null

          if (amountGross !== null || amountNet !== null) {
            try {
              await createCrud(
                'sales/order-adjustments',
                {
                  orderId,
                  organizationId: organizationId ?? undefined,
                  tenantId: tenantId ?? undefined,
                  scope: 'order',
                  kind: 'shipping',
                  label:
                    method?.name ??
                    t('sales.documents.shipments.shippingAdjustmentLabel', 'Shipping cost'),
                  code: shipmentNumber ? `ship-${shipmentNumber}` : undefined,
                  amountGross: amountGross ?? undefined,
                  amountNet: amountNet ?? undefined,
                  currencyCode: currency ?? undefined,
                  metadata: {
                    shipmentId,
                    shippingMethodId,
                    calculation: 'per_item_base_rate',
                    quantity: totalQuantity,
                  },
                },
                {
                  errorMessage: t(
                    'sales.documents.shipments.shippingAdjustmentError',
                    'Failed to add shipping cost adjustment.',
                  ),
                },
              )
              emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
            } catch (err) {
              console.warn('sales.shipments.adjustment.create', err)
              flash(
                t(
                  'sales.documents.shipments.shippingAdjustmentError',
                  'Failed to add shipping cost adjustment.',
                ),
                'warning',
              )
            }
          }
        }
        if (values.postComment && onAddComment) {
          const lineTitles = items
            .map((item) => {
              const line = lines.find((entry) => entry.id === item.lineId)
              return `${item.quantity}× ${line?.title ?? item.lineId}`
            })
            .join(', ')
          const commentNotes =
            typeof values.notes === 'string' && values.notes.trim().length
              ? values.notes.trim()
              : ''
          const label =
            shipmentNumber.length > 0
              ? `#${shipmentNumber}`
              : shipment?.id
                ? `#${shipment.id.slice(0, 6)}`
                : ''
          const noteParts = [
            t('sales.documents.shipments.comment', 'Shipment {{number}} updated: {{summary}}', {
              number: label || String((result.result as any)?.id ?? ''),
              summary: lineTitles,
            }),
          ]
          if (commentNotes) {
            noteParts.push(
              t('sales.documents.shipments.commentNotes', 'Notes: {{notes}}', { notes: commentNotes }),
            )
          }
          const note = noteParts.join('\n\n')
          try {
            await onAddComment(note)
          } catch (err) {
            console.warn('sales.shipments.comment', err)
          }
        }
        await onSaved()
      }
    },
    [
      currencyCode,
      lines,
      mode,
      onAddComment,
      onSaved,
      orderId,
      organizationId,
      shipment?.id,
      addressOptions,
      addressOptionsMap,
      shippingMethods,
      t,
      tenantId,
      validateItems,
    ],
  )

  const handleShortcutSubmit = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      const form = dialogContentRef.current?.querySelector('form')
      form?.requestSubmit()
    }
  }, [])

  const fields = React.useMemo<CrudField[]>(() => {
    const shippingAdjustmentLabel = t(
      'sales.documents.shipments.addShippingAdjustment',
      'Add shipping cost adjustment for this shipment',
    )
    const shippingAdjustmentHelp = t(
      'sales.documents.shipments.addShippingAdjustmentHelp',
      'Create a shipping adjustment using this carrier’s calculated cost.',
    )
    const itemsField: CrudField = {
      id: 'items',
      label: t('sales.documents.shipments.items', 'Items to ship'),
      type: 'custom',
      component: ({ value, setValue, error }) => {
        const quantities = (value as Record<string, string | number> | null) ?? {}
        const [lineErrors, setLineErrors] = React.useState<Record<string, string | undefined>>({})

        React.useEffect(() => {
          registerItemErrors(setLineErrors)
          return () => {
            if (itemErrorSetterRef.current === setLineErrors) {
              itemErrorSetterRef.current = null
            }
          }
        }, [])

        if (lines.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              {t('sales.documents.shipments.noLines', 'No order lines available.')}
            </p>
          )
        }

        return (
          <div className="space-y-2 rounded-lg border p-3">
            {lines.map((line) => {
              const available = computeAvailable(line.id, shipment?.id ?? null)
              const rawValue = quantities[line.id]
              const valueString =
                typeof rawValue === 'number'
                  ? rawValue.toString()
                  : typeof rawValue === 'string'
                    ? rawValue
                    : ''
              const disabled = available <= 0 && !valueString
              const lineError = lineErrors[line.id]
              return (
                <div
                  key={line.id}
                  className={cn(
                    'grid gap-3 md:grid-cols-[1fr,140px]',
                    disabled ? 'opacity-60' : null,
                  )}
                >
                  <div className="flex items-start gap-3">
                    {line.thumbnail ? (
                      <img
                        src={line.thumbnail}
                        alt={line.title}
                        className="h-12 w-12 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">
                        N/A
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {line.lineNumber ? `#${line.lineNumber} · ` : null}
                        {line.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('sales.documents.shipments.available', '{{count}} available', {
                          count: available,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={valueString}
                      disabled={disabled}
                      onChange={(event) => {
                        const next = event.target.value
                        setValue({ ...(quantities ?? {}), [line.id]: next })
                        setLineErrors((prev) => ({ ...prev, [line.id]: undefined }))
                      }}
                    />
                    {lineError ? <p className="text-xs text-destructive">{lineError}</p> : null}
                  </div>
                </div>
              )
            })}
          </div>
        )
      },
    }

    return [
      {
        id: 'shipmentNumber',
        label: t('sales.documents.shipments.number', 'Shipment number'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => (
          <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
          />
        ),
      },
      {
        id: 'carrierName',
        label: t('sales.documents.shipments.carrier', 'Carrier'),
        type: 'custom',
        component: ({ value, setValue }) => (
          <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
          />
        ),
      },
      {
        id: 'shippingMethodId',
        label: t('sales.documents.shipments.shippingMethod', 'Shipping method'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' && value.length ? value : null
          return (
            <LookupSelect
              value={currentValue}
              onChange={(next) => setValue(next ?? '')}
              fetchItems={fetchShippingMethodItems}
              placeholder={t('sales.documents.shipments.shippingMethodPlaceholder', 'Select method')}
            />
          )
        },
      },
      {
        id: 'statusEntryId',
        label: t('sales.documents.shipments.status', 'Shipment status'),
        type: 'custom',
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' && value.length ? value : null
          return (
            <LookupSelect
              value={currentValue}
              onChange={(next) => setValue(next ?? '')}
              fetchItems={fetchShipmentStatusItems}
              placeholder={t('sales.documents.shipments.statusPlaceholder', 'Select shipment status')}
              loading={shipmentStatusLoading}
              minQuery={0}
            />
          )
        },
      },
      ...(mode === 'create'
        ? ([
            {
              id: 'documentStatusEntryId',
              label: t('sales.documents.status.changeDocument', 'Change order/quote status'),
              type: 'custom',
              component: ({ value, setValue }) => {
                const currentValue = typeof value === 'string' && value.length ? value : null
                return (
                  <LookupSelect
                    value={currentValue}
                    onChange={(next) => setValue(next ?? '')}
                    fetchItems={fetchDocumentStatusItems}
                    placeholder={t(
                      'sales.documents.status.documentPlaceholder',
                      'Select new order/quote status',
                    )}
                    loading={documentStatusLoading}
                    minQuery={0}
                  />
                )
              },
            },
            {
              id: 'lineStatusEntryId',
              label: t('sales.documents.status.changeLine', 'Change order/quote item status'),
              type: 'custom',
              component: ({ value, setValue }) => {
                const currentValue = typeof value === 'string' && value.length ? value : null
                return (
                  <LookupSelect
                    value={currentValue}
                    onChange={(next) => setValue(next ?? '')}
                    fetchItems={fetchLineStatusItems}
                    placeholder={t(
                      'sales.documents.status.linePlaceholder',
                      'Select item status',
                    )}
                    loading={lineStatusLoading}
                    minQuery={0}
                  />
                )
              },
            },
          ] as CrudField[])
        : []),
      {
        id: 'shipmentAddressId',
        label: t('sales.documents.shipments.address', 'Ship to'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' ? value : ''
          React.useEffect(() => {
            if (!currentValue && addressOptions.length) {
              setValue(addressOptions[0].id)
            }
          }, [addressOptions, currentValue, setValue])
          const disabled = addressLoading || !addressOptions.length
          return (
            <div className="space-y-2">
              <LookupSelect
                value={currentValue || null}
                onChange={(next) => setValue(next ?? '')}
                fetchItems={fetchAddressItems}
                placeholder={t('sales.documents.shipments.addressPlaceholder', 'Select address')}
                searchPlaceholder={t('sales.documents.shipments.addressSearch', 'Search address')}
                minQuery={0}
                disabled={disabled}
                loading={addressLoading}
                defaultOpen
              />
              {!addressLoading && !addressOptions.length ? (
                <p className="text-xs text-destructive">
                  {t(
                    'sales.documents.shipments.addressMissing',
                    'Add an address to this document before creating a shipment.',
                  )}
                </p>
              ) : null}
              {addressError ? <p className="text-xs text-destructive">{addressError}</p> : null}
            </div>
          )
        },
      },
      {
        id: 'shippedAt',
        label: t('sales.documents.shipments.shippedAt', 'Shipped date'),
        type: 'date',
      },
      {
        id: 'deliveredAt',
        label: t('sales.documents.shipments.deliveredAt', 'Delivered date'),
        type: 'date',
      },
      {
        id: 'trackingNumbers',
        label: t('sales.documents.shipments.trackingNumbers', 'Tracking numbers'),
        type: 'custom',
        component: ({ value, setValue }) => (
          <Textarea
            rows={2}
            placeholder={t(
              'sales.documents.shipments.trackingPlaceholder',
              'One per line or comma separated',
            )}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
          />
        ),
      },
      {
        id: 'notes',
        label: t('sales.documents.shipments.notes', 'Notes'),
        type: 'custom',
        component: ({ value, setValue }) => (
          <Textarea
            rows={3}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
          />
        ),
      },
      {
        id: 'addShippingAdjustment',
        label: shippingAdjustmentLabel,
        type: 'custom',
        component: ({ value, setValue }) => (
          <div className="flex items-start gap-2">
            <Switch
              id={SHIPPING_ADJUSTMENT_TOGGLE_ID}
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValue(Boolean(checked))}
              aria-labelledby={SHIPPING_ADJUSTMENT_LABEL_ID}
              aria-describedby={SHIPPING_ADJUSTMENT_HELP_ID}
            />
            <div className="space-y-1">
              <Label
                htmlFor={SHIPPING_ADJUSTMENT_TOGGLE_ID}
                id={SHIPPING_ADJUSTMENT_LABEL_ID}
                className="sr-only"
              >
                {shippingAdjustmentLabel}
              </Label>
              <p id={SHIPPING_ADJUSTMENT_HELP_ID} className="text-xs text-muted-foreground">
                {shippingAdjustmentHelp}
              </p>
            </div>
          </div>
        ),
      },
      itemsField,
      {
        id: 'postComment',
        label: t('sales.documents.shipments.addComment', 'Add note to comments'),
        type: 'custom',
        component: ({ value, setValue }) => (
          <div className="flex items-center gap-2">
            <Switch
              id="shipment-comment"
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValue(Boolean(checked))}
            />
            <Label htmlFor="shipment-comment" className="cursor-pointer">
              {t('sales.documents.shipments.addComment', 'Add note to comments')}
            </Label>
          </div>
        ),
      },
    ]
  }, [
    addressError,
    addressLoading,
    addressOptions,
    computeAvailable,
    documentStatusLoading,
    fetchAddressItems,
    fetchDocumentStatusItems,
    fetchLineStatusItems,
    fetchShipmentStatusItems,
    fetchShippingMethodItems,
    lineStatusLoading,
    lines,
    mode,
    registerItemErrors,
    shipment?.id,
    shipmentStatusLoading,
    t,
  ])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => {
      const base: CrudFormGroup[] = [
        {
          id: 'shipmentDetails',
          title: mode === 'edit'
            ? t('sales.documents.shipments.editTitle', 'Edit shipment')
            : t('sales.documents.shipments.addTitle', 'Add shipment'),
          column: 1,
          fields: ['shipmentNumber', 'carrierName', 'shippingMethodId', 'statusEntryId', 'shipmentAddressId'],
        },
      ]
      if (mode === 'create') {
        base.push({
          id: 'statusChanges',
          title: t('sales.documents.status.sectionTitle', 'Status changes'),
          column: 2,
          fields: ['documentStatusEntryId', 'lineStatusEntryId'],
        })
      }
      base.push(
        {
          id: 'tracking',
          title: t('sales.documents.shipments.trackingGroup', 'Tracking information'),
          column: 2,
          fields: ['shippedAt', 'deliveredAt', 'trackingNumbers', 'notes'],
        },
        {
          id: 'items',
          column: 1,
          fields: ['items', 'addShippingAdjustment', 'postComment'],
        },
        {
          id: 'shipmentCustomFields',
          title: t('entities.customFields.title', 'Custom fields'),
          column: 2,
          kind: 'customFields',
        },
      )
      return base
    },
    [mode, t],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        ref={dialogContentRef}
        className="sm:max-w-5xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          handleShortcutSubmit(event)
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit'
              ? t('sales.documents.shipments.editTitle', 'Edit shipment')
              : t('sales.documents.shipments.addTitle', 'Add shipment')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm
          key={formResetKey}
          embedded
          entityId={E.sales.sales_shipment}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('sales.documents.shipments.saveShortcut', 'Save (⌘/Ctrl+Enter)')}
          onSubmit={handleSubmit}
          loadingMessage={t('sales.documents.shipments.loading', 'Loading shipments…')}
          customFieldsLoadingMessage={t('ui.forms.loading', 'Loading data...')}
          isLoading={shippingMethodLoading || addressLoading}
        />
      </DialogContent>
    </Dialog>
  )
}
