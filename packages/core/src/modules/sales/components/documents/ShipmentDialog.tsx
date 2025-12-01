"use client"

import * as React from 'react'
import { Truck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { cn } from '@open-mercato/shared/lib/utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { formatMoney, normalizeNumber } from './lineItemUtils'
import type { OrderLine, ShipmentRow } from './shipmentTypes'

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
  shippingAddressSnapshot?: Record<string, unknown> | null
  onClose: () => void
  onSaved: () => Promise<void>
  onAddComment?: (body: string) => Promise<void>
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
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const itemErrorSetterRef = React.useRef<((errors: Record<string, string>) => void) | null>(null)

  const baseItems = React.useMemo(
    () =>
      lines.reduce<Record<string, string>>((acc, line) => {
        acc[line.id] = ''
        return acc
      }, {}),
    [lines],
  )

  const initialValues = React.useMemo(
    () => ({
      shipmentNumber: shipment?.shipmentNumber ?? '',
      carrierName: shipment?.carrierName ?? '',
      shippingMethodId: shipment?.shippingMethodId ?? '',
      shippedAt: shipment?.shippedAt ? shipment.shippedAt.slice(0, 10) : '',
      deliveredAt: shipment?.deliveredAt ? shipment.deliveredAt.slice(0, 10) : '',
      trackingNumbers: shipment?.trackingNumbers?.join('\n') ?? '',
      notes: shipment?.notes ?? '',
      postComment: true,
      items: lines.reduce<Record<string, string>>((acc, line) => {
        const found = shipment?.items.find((item) => item.orderLineId === line.id)
        acc[line.id] = found ? String(found.quantity) : ''
        return acc
      }, baseItems),
      ...prefixCustomFieldValues(shipment?.customValues ?? null),
    }),
    [baseItems, lines, shipment?.carrierName, shipment?.customValues, shipment?.deliveredAt, shipment?.items, shipment?.notes, shipment?.shipmentNumber, shipment?.shippedAt, shipment?.shippingMethodId, shipment?.trackingNumbers],
  )

  const registerItemErrors = React.useCallback((updater: (errors: Record<string, string>) => void) => {
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
    async (query?: string): Promise<ShippingMethodOption[]> => {
      setShippingMethodLoading(true)
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
        setShippingMethodLoading(false)
      }
    },
    [mapShippingMethod],
  )

  const fetchShippingMethodItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options = !query
        ? shippingMethods
        : await loadShippingMethods(query)
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

  React.useEffect(() => {
    if (!open) return
    setFormResetKey((prev) => prev + 1)
    if (!shippingMethods.length) {
      void loadShippingMethods()
    }
  }, [loadShippingMethods, open, shippingMethods.length])

  React.useEffect(() => {
    if (shipment?.shippingMethodId) {
      ensureShippingMethodOption(
        mapShippingMethod({
          id: shipment.shippingMethodId,
          name: shipment.shippingMethodCode ?? shipment.shippingMethodId,
          code: shipment.shippingMethodCode ?? shipment.shippingMethodId,
          currencyCode: currencyCode ?? null,
        }),
      )
    }
  }, [currencyCode, ensureShippingMethodOption, mapShippingMethod, shipment?.shippingMethodCode, shipment?.shippingMethodId])

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
      const payload: Record<string, unknown> = {
        orderId,
        organizationId: organizationId ?? undefined,
        tenantId: tenantId ?? undefined,
        shipmentNumber,
        shippingMethodId,
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
      if (shippingAddressSnapshot) {
        payload.shipmentAddressSnapshot = shippingAddressSnapshot
      }
      const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
      if (Object.keys(customFields).length) {
        payload.customFields = customFields
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
        if (values.postComment && onAddComment) {
          const lineTitles = items
            .map((item) => {
              const line = lines.find((entry) => entry.id === item.lineId)
              return `${item.quantity}× ${line?.title ?? item.lineId}`
            })
            .join(', ')
          const label =
            shipmentNumber.length > 0
              ? `#${shipmentNumber}`
              : shipment?.id
                ? `#${shipment.id.slice(0, 6)}`
                : ''
          const note = t(
            'sales.documents.shipments.comment',
            'Shipment {{number}} updated: {{summary}}',
            { number: label || String((result.result as any)?.id ?? ''), summary: lineTitles },
          )
          try {
            await onAddComment(note)
          } catch (err) {
            console.warn('sales.shipments.comment', err)
          }
        }
        await onSaved()
      }
    },
    [lines, onAddComment, onSaved, orderId, organizationId, shipment?.id, shippingAddressSnapshot, t, tenantId, validateItems],
  )

  const handleShortcutSubmit = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      const form = dialogContentRef.current?.querySelector('form')
      form?.requestSubmit()
    }
  }, [])

  const fields = React.useMemo<CrudField[]>(() => {
    const itemsField: CrudField = {
      id: 'items',
      label: t('sales.documents.shipments.items', 'Items to ship'),
      type: 'custom',
      component: ({ value, setValue, error }) => {
        const quantities = (value as Record<string, string | number> | null) ?? {}
        const [lineErrors, setLineErrors] = React.useState<Record<string, string>>({})

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
                    'grid gap-2 md:grid-cols-[1fr,140px]',
                    disabled ? 'opacity-60' : null,
                  )}
                >
                  <div>
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
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
  }, [computeAvailable, fetchShippingMethodItems, lines, registerItemErrors, shipment?.id, t])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'shipmentDetails',
        title: t('sales.documents.shipments.addTitle', 'Add shipment'),
        column: 1,
        fields: ['shipmentNumber', 'carrierName', 'shippingMethodId'],
      },
      {
        id: 'tracking',
        title: t('sales.documents.shipments.trackingGroup', 'Tracking information'),
        column: 1,
        fields: ['shippedAt', 'deliveredAt', 'trackingNumbers', 'notes'],
      },
      {
        id: 'items',
        title: t('sales.documents.shipments.items', 'Items to ship'),
        column: 1,
        fields: ['items', 'postComment'],
      },
      {
        id: 'shipmentCustomFields',
        title: t('entities.customFields.title', 'Custom fields'),
        column: 2,
        kind: 'customFields',
      },
    ],
    [t],
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
          isLoading={shippingMethodLoading}
        />
      </DialogContent>
    </Dialog>
  )
}
