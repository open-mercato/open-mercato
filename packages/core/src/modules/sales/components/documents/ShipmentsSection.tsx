"use client"

import * as React from 'react'
import { Plus, Pencil, Trash2, Truck } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { cn } from '@open-mercato/shared/lib/utils'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import type { SectionAction } from '@open-mercato/core/modules/customers/components/detail/types'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'

type ShipmentItem = {
  id: string
  orderLineId: string
  orderLineName: string | null
  orderLineNumber: number | null
  quantity: number
  metadata?: Record<string, unknown> | null
}

type ShipmentRow = {
  id: string
  shipmentNumber: string | null
  status: string | null
  statusEntryId?: string | null
  carrierName: string | null
  trackingNumbers: string[]
  shippedAt: string | null
  deliveredAt: string | null
  notes: string | null
  metadata?: Record<string, unknown> | null
  items: ShipmentItem[]
  createdAt?: string | null
}

type OrderLine = {
  id: string
  title: string
  lineNumber: number | null
  quantity: number
}

type FormState = {
  shipmentNumber: string
  carrierName: string
  trackingNumbers: string
  shippedAt: string
  deliveredAt: string
  notes: string
  attachAddress: boolean
  postComment: boolean
  items: Record<string, string>
}

const ADDRESS_SNAPSHOT_KEY = 'shipmentAddressSnapshot'

type SalesShipmentsSectionProps = {
  orderId: string
  currencyCode?: string | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  onActionChange?: (action: SectionAction | null) => void
  onAddComment?: (body: string) => Promise<void>
}

const defaultFormState = (lines: OrderLine[], attachAddress: boolean): FormState => {
  const items: Record<string, string> = {}
  lines.forEach((line) => {
    items[line.id] = ''
  })
  return {
    shipmentNumber: '',
    carrierName: '',
    trackingNumbers: '',
    shippedAt: '',
    deliveredAt: '',
    notes: '',
    attachAddress,
    postComment: true,
    items,
  }
}

const parseTrackingNumbers = (value: string): string[] =>
  value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

function formatDisplayDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function SalesShipmentsSection({
  orderId,
  shippingAddressSnapshot,
  onActionChange,
  onAddComment,
}: SalesShipmentsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const [shipments, setShipments] = React.useState<ShipmentRow[]>([])
  const [lines, setLines] = React.useState<OrderLine[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(() => defaultFormState([], Boolean(shippingAddressSnapshot)))
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [formErrors, setFormErrors] = React.useState<Record<string, string | undefined>>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const lineMap = React.useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines])

  const shippedTotals = React.useMemo(() => {
    const totals = new Map<string, number>()
    shipments.forEach((shipment) => {
      shipment.items.forEach((item) => {
        const current = totals.get(item.orderLineId) ?? 0
        totals.set(item.orderLineId, current + (Number.isFinite(item.quantity) ? item.quantity : 0))
      })
    })
    return totals
  }, [shipments])

  const computeAvailable = React.useCallback(
    (lineId: string, excludeShipmentId?: string | null) => {
      const line = lineMap.get(lineId)
      if (!line) return 0
      const shipped = shippedTotals.get(lineId) ?? 0
      const editingShipment = excludeShipmentId ? shipments.find((entry) => entry.id === excludeShipmentId) : null
      const editingQty =
        editingShipment?.items
          .filter((item) => item.orderLineId === lineId)
          .reduce((acc, item) => acc + (Number.isFinite(item.quantity) ? item.quantity : 0), 0) ?? 0
      const remaining = line.quantity - (shipped - editingQty)
      return remaining < 0 ? 0 : remaining
    },
    [lineMap, shipments, shippedTotals]
  )

  const loadLines = React.useCallback(async () => {
    const params = new URLSearchParams({ page: '1', pageSize: '200', orderId })
    const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
      `/api/sales/order-lines?${params.toString()}`,
      undefined,
      { fallback: { items: [] } }
    )
    const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
    const mapped: OrderLine[] = items
      .map((item) => {
        const id = typeof item.id === 'string' ? item.id : null
        if (!id) return null
        const name =
          typeof item.name === 'string'
            ? item.name
            : typeof (item as any).catalog_snapshot === 'object' &&
                (item as any).catalog_snapshot &&
                typeof (item as any).catalog_snapshot.name === 'string'
              ? (item as any).catalog_snapshot.name
              : null
        const lineNumber =
          typeof (item as any).line_number === 'number'
            ? (item as any).line_number
            : typeof (item as any).lineNumber === 'number'
              ? (item as any).lineNumber
              : null
        const quantity =
          typeof item.quantity === 'number'
            ? item.quantity
            : typeof (item as any).quantity === 'string'
              ? Number((item as any).quantity)
              : 0
        return {
          id,
          title: name ?? id,
          lineNumber,
          quantity: Number.isFinite(quantity) ? quantity : 0,
        }
      })
      .filter((entry): entry is OrderLine => Boolean(entry?.id))
    setLines(mapped)
  }, [orderId])

  const loadShipments = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200', orderId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/shipments?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
      const mapped: ShipmentRow[] = items
        .map((item) => {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id) return null
          const itemsRaw = Array.isArray((item as any).items) ? ((item as any).items as Array<Record<string, unknown>>) : []
          const shipmentItems: ShipmentItem[] = itemsRaw
            .map((entry) => {
              const lineId =
                typeof entry.orderLineId === 'string'
                  ? entry.orderLineId
                  : typeof (entry as any).order_line_id === 'string'
                    ? (entry as any).order_line_id
                    : null
              if (!lineId) return null
              const quantity =
                typeof entry.quantity === 'number'
                  ? entry.quantity
                  : typeof (entry as any).quantity === 'string'
                    ? Number((entry as any).quantity)
                    : 0
              return {
                id: typeof entry.id === 'string' ? entry.id : generateTempId(),
                orderLineId: lineId,
                orderLineName:
                  typeof entry.orderLineName === 'string'
                    ? entry.orderLineName
                    : typeof (entry as any).order_line_name === 'string'
                      ? (entry as any).order_line_name
                      : null,
                orderLineNumber:
                  typeof entry.orderLineNumber === 'number'
                    ? entry.orderLineNumber
                    : typeof (entry as any).order_line_number === 'number'
                      ? (entry as any).order_line_number
                      : null,
                quantity: Number.isFinite(quantity) ? quantity : 0,
                metadata: (entry.metadata as Record<string, unknown> | undefined | null) ?? null,
              }
            })
            .filter((entry): entry is ShipmentItem => Boolean(entry))
          const tracking =
            Array.isArray((item as any).tracking_numbers) && (item as any).tracking_numbers.length
              ? ((item as any).tracking_numbers as string[])
              : []
          return {
            id,
            shipmentNumber:
              typeof (item as any).shipment_number === 'string'
                ? (item as any).shipment_number
                : typeof (item as any).shipmentNumber === 'string'
                  ? (item as any).shipmentNumber
                  : null,
            status:
              typeof item.status === 'string'
                ? item.status
                : typeof (item as any).status === 'string'
                  ? (item as any).status
                  : null,
            statusEntryId:
              typeof (item as any).status_entry_id === 'string'
                ? (item as any).status_entry_id
                : typeof (item as any).statusEntryId === 'string'
                  ? (item as any).statusEntryId
                  : null,
            carrierName:
              typeof (item as any).carrier_name === 'string'
                ? (item as any).carrier_name
                : typeof (item as any).carrierName === 'string'
                  ? (item as any).carrierName
                  : null,
            trackingNumbers: tracking,
            shippedAt:
              typeof (item as any).shipped_at === 'string'
                ? (item as any).shipped_at
                : typeof (item as any).shippedAt === 'string'
                  ? (item as any).shippedAt
                  : null,
            deliveredAt:
              typeof (item as any).delivered_at === 'string'
                ? (item as any).delivered_at
                : typeof (item as any).deliveredAt === 'string'
                  ? (item as any).deliveredAt
                  : null,
            notes:
              typeof (item as any).notes === 'string'
                ? (item as any).notes
                : typeof (item as any).notesText === 'string'
                  ? (item as any).notesText
                  : null,
            metadata: (item as Record<string, unknown> | null | undefined)?.metadata ?? null,
            items: shipmentItems,
            createdAt:
              typeof (item as any).created_at === 'string'
                ? (item as any).created_at
                : typeof (item as any).createdAt === 'string'
                  ? (item as any).createdAt
                  : null,
          }
        })
        .filter((entry): entry is ShipmentRow => Boolean(entry))
      setShipments(mapped)
    } catch (err) {
      console.error('sales.shipments.load', err)
      setError(t('sales.documents.shipments.errorLoad', 'Failed to load shipments.'))
    } finally {
      setLoading(false)
    }
  }, [orderId, t])

  React.useEffect(() => {
    void loadLines()
    void loadShipments()
  }, [loadLines, loadShipments])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: t('sales.documents.shipments.add', 'Add shipment'),
      onClick: handleOpenCreate,
      disabled: false,
    })
    return () => onActionChange(null)
  }, [handleOpenCreate, onActionChange, t])

  const resetForm = React.useCallback(() => {
    setForm(defaultFormState(lines, Boolean(shippingAddressSnapshot)))
    setFormErrors({})
    setSubmitError(null)
    setEditingId(null)
  }, [lines, shippingAddressSnapshot])

  const handleOpenCreate = React.useCallback(() => {
    resetForm()
    setDialogOpen(true)
  }, [resetForm])

  const handleEdit = React.useCallback(
    (shipment: ShipmentRow) => {
      const nextForm = defaultFormState(lines, Boolean(shippingAddressSnapshot))
      nextForm.shipmentNumber = shipment.shipmentNumber ?? ''
      nextForm.carrierName = shipment.carrierName ?? ''
      nextForm.trackingNumbers = shipment.trackingNumbers.join('\n')
      nextForm.shippedAt = shipment.shippedAt ? shipment.shippedAt.slice(0, 10) : ''
      nextForm.deliveredAt = shipment.deliveredAt ? shipment.deliveredAt.slice(0, 10) : ''
      nextForm.notes = shipment.notes ?? ''
      nextForm.items = lines.reduce<Record<string, string>>((acc, line) => {
        const found = shipment.items.find((item) => item.orderLineId === line.id)
        acc[line.id] = found ? found.quantity.toString() : ''
        return acc
      }, {})
      nextForm.attachAddress = Boolean(
        shipment.metadata && ADDRESS_SNAPSHOT_KEY in shipment.metadata
      )
      setEditingId(shipment.id)
      setForm(nextForm)
      setDialogOpen(true)
    },
    [lines, shippingAddressSnapshot]
  )

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    resetForm()
  }, [resetForm])

  const normalizeItems = React.useCallback(
    (excludeShipmentId?: string | null) => {
      setFormErrors({})
      const entries = Object.entries(form.items)
        .map(([lineId, value]) => ({ lineId, quantity: Number(value) }))
        .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
      if (!entries.length) {
        setSubmitError(t('sales.documents.shipments.errorItems', 'Ship at least one line item.'))
        throw new Error('validation_failed')
      }
      const errors: Record<string, string> = {}
      entries.forEach((entry) => {
        const available = computeAvailable(entry.lineId, excludeShipmentId)
        if (entry.quantity > available + 1e-6) {
          errors[entry.lineId] = t('sales.documents.shipments.errorQuantity', 'Quantity exceeds remaining available.')
        }
      })
      if (Object.keys(errors).length) {
        setFormErrors(errors)
        throw new Error('validation_failed')
      }
      return entries
    },
    [computeAvailable, form.items, t]
  )

  const handleSubmit = React.useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (saving) return
      setSaving(true)
      setSubmitError(null)
      try {
        const items = normalizeItems(editingId)
        const payload: Record<string, unknown> = {
          orderId,
          organizationId,
          tenantId,
          shipmentNumber: form.shipmentNumber?.trim() || undefined,
          carrierName: form.carrierName?.trim() || undefined,
          trackingNumbers: parseTrackingNumbers(form.trackingNumbers ?? ''),
          shippedAt: form.shippedAt ? new Date(form.shippedAt) : undefined,
          deliveredAt: form.deliveredAt ? new Date(form.deliveredAt) : undefined,
          notes: form.notes?.trim() || undefined,
          items: items.map((item) => ({
            orderLineId: item.lineId,
            quantity: item.quantity,
          })),
        }
        if (form.attachAddress && shippingAddressSnapshot) {
          payload.shipmentAddressSnapshot = shippingAddressSnapshot
        }
        const action = editingId ? updateCrud : createCrud
        const result = await action(
          'sales/shipments',
          editingId ? { id: editingId, ...payload } : payload,
          {
            successMessage: editingId
              ? t('sales.documents.shipments.updated', 'Shipment updated.')
              : t('sales.documents.shipments.created', 'Shipment created.'),
            errorMessage: t('sales.documents.shipments.errorSave', 'Failed to save shipment.'),
          }
        )
        if (result.ok) {
          await loadShipments()
          if (form.postComment && onAddComment) {
            const summary = items
              .map((item) => {
                const line = lineMap.get(item.lineId)
                return `${item.quantity}× ${line?.title ?? item.lineId}`
              })
              .join(', ')
            const label =
              form.shipmentNumber?.trim().length
                ? `#${form.shipmentNumber.trim()}`
                : editingId
                  ? `#${editingId.slice(0, 6)}`
                  : ''
            const note = t(
              'sales.documents.shipments.comment',
              'Shipment {{number}} updated: {{summary}}',
              { number: label || result.result?.id || '', summary }
            )
            try {
              await onAddComment(note)
            } catch (err) {
              console.warn('sales.shipments.comment', err)
            }
          }
          closeDialog()
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'validation_failed') {
          setSubmitError(t('sales.documents.shipments.errorQuantity', 'Quantity exceeds remaining available.'))
        } else {
          console.error('sales.shipments.save', err)
          const mapped = mapCrudServerErrorToFormErrors(err)
          if (mapped.fieldErrors) {
            setFormErrors((prev) => ({ ...prev, ...mapped.fieldErrors }))
          }
          setSubmitError(
            mapped.message ??
              t('sales.documents.shipments.errorSave', 'Failed to save shipment.')
          )
        }
      } finally {
        setSaving(false)
      }
    },
    [
      closeDialog,
      computeAvailable,
      editingId,
      form.attachAddress,
      form.carrierName,
      form.deliveredAt,
      form.items,
      form.notes,
      form.postComment,
      form.shipmentNumber,
      form.shippedAt,
      form.trackingNumbers,
      lineMap,
      loadShipments,
      normalizeItems,
      onAddComment,
      orderId,
      organizationId,
      saving,
      shippingAddressSnapshot,
      t,
      tenantId,
    ]
  )

  const handleDelete = React.useCallback(
    async (shipment: ShipmentRow) => {
      const confirmed = window.confirm(
        t('sales.documents.shipments.confirmDelete', 'Delete this shipment?')
      )
      if (!confirmed) return
      try {
        const result = await deleteCrud(
          'sales/shipments',
          {
            id: shipment.id,
            orderId,
            organizationId,
            tenantId,
          },
          { successMessage: t('sales.documents.shipments.deleted', 'Shipment deleted.') }
        )
        if (result.ok) {
          await loadShipments()
        }
      } catch (err) {
        console.error('sales.shipments.delete', err)
        flash(t('sales.documents.shipments.errorDelete', 'Failed to delete shipment.'), 'error')
      }
    },
    [loadShipments, orderId, organizationId, t, tenantId]
  )

  const renderItemList = (items: ShipmentItem[]) => (
    <ul className="space-y-1 text-sm text-muted-foreground">
      {items.map((item) => {
        const label = item.orderLineNumber ? `#${item.orderLineNumber}` : ''
        return (
          <li key={item.id} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {label ? `${label} · ` : null}
              {item.orderLineName ?? item.orderLineId}
            </span>
            <Badge variant="secondary">{item.quantity}</Badge>
          </li>
        )
      })}
    </ul>
  )

  if (loading) {
    return <LoadingMessage label={t('sales.documents.shipments.loading', 'Loading shipments…')} />
  }

  if (error) {
    return <ErrorMessage label={error} />
  }

  const empty = !shipments.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t('sales.documents.shipments.title', 'Shipments')}</p>
          <p className="text-sm text-muted-foreground">
            {t('sales.documents.shipments.subtitle', 'Track packages and fulfillment for this order.')}
          </p>
        </div>
        <Button size="sm" onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t('sales.documents.shipments.add', 'Add shipment')}
        </Button>
      </div>

      {empty ? (
        <TabEmptyState
          title={t('sales.documents.shipments.empty.title', 'No shipments yet.')}
          description={t(
            'sales.documents.shipments.empty.description',
            'Create your first shipment to mark items as fulfilled.'
          )}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shipments.map((shipment) => {
            const shippedAt = formatDisplayDate(shipment.shippedAt)
            const deliveredAt = formatDisplayDate(shipment.deliveredAt)
            const hasAddressSnapshot =
              shipment.metadata && ADDRESS_SNAPSHOT_KEY in shipment.metadata
            return (
              <div key={shipment.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {shipment.shipmentNumber
                          ? t('sales.documents.shipments.numberLabel', 'Shipment {{number}}', {
                              number: shipment.shipmentNumber,
                            })
                          : t('sales.documents.shipments.fallbackNumber', 'Shipment {{id}}', {
                              id: shipment.id.slice(0, 6),
                            })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {shipment.status ?? t('sales.documents.shipments.statusMissing', 'Status pending')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(shipment)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => void handleDelete(shipment)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    {shipment.carrierName ? (
                      <Badge variant="outline">{shipment.carrierName}</Badge>
                    ) : null}
                    {shipment.trackingNumbers.length ? (
                      <span className="truncate">
                        {t('sales.documents.shipments.tracking', 'Tracking')}: {shipment.trackingNumbers.join(', ')}
                      </span>
                    ) : null}
                  </div>
                  {shippedAt ? (
                    <p className="text-muted-foreground">
                      {t('sales.documents.shipments.shippedOn', 'Shipped on {{date}}', { date: shippedAt })}
                    </p>
                  ) : null}
                  {deliveredAt ? (
                    <p className="text-muted-foreground">
                      {t('sales.documents.shipments.deliveredOn', 'Delivered on {{date}}', { date: deliveredAt })}
                    </p>
                  ) : null}
                  {hasAddressSnapshot ? (
                    <p className="text-xs text-muted-foreground">
                      {t('sales.documents.shipments.addressSnapshot', 'Address snapshot saved.')}
                    </p>
                  ) : null}
                  {shipment.notes ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                      {shipment.notes}
                    </p>
                  ) : null}
                  {renderItemList(shipment.items)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => (!open ? closeDialog() : undefined)}>
        <DialogContent
          className="max-w-2xl"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeDialog()
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void handleSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t('sales.documents.shipments.editTitle', 'Edit shipment')
                : t('sales.documents.shipments.addTitle', 'Add shipment')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="shipment-number">
                  {t('sales.documents.shipments.number', 'Shipment number')}
                </Label>
                <Input
                  id="shipment-number"
                  value={form.shipmentNumber}
                  onChange={(event) => setForm((prev) => ({ ...prev, shipmentNumber: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipment-carrier">
                  {t('sales.documents.shipments.carrier', 'Carrier')}
                </Label>
                <Input
                  id="shipment-carrier"
                  value={form.carrierName}
                  onChange={(event) => setForm((prev) => ({ ...prev, carrierName: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipment-shipped">
                  {t('sales.documents.shipments.shippedAt', 'Shipped date')}
                </Label>
                <Input
                  id="shipment-shipped"
                  type="date"
                  value={form.shippedAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, shippedAt: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipment-delivered">
                  {t('sales.documents.shipments.deliveredAt', 'Delivered date')}
                </Label>
                <Input
                  id="shipment-delivered"
                  type="date"
                  value={form.deliveredAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, deliveredAt: event.target.value }))}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="shipment-tracking">
                  {t('sales.documents.shipments.trackingNumbers', 'Tracking numbers')}
                </Label>
                <Textarea
                  id="shipment-tracking"
                  rows={2}
                  placeholder={t('sales.documents.shipments.trackingPlaceholder', 'One per line or comma separated')}
                  value={form.trackingNumbers}
                  onChange={(event) => setForm((prev) => ({ ...prev, trackingNumbers: event.target.value }))}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="shipment-notes">
                  {t('sales.documents.shipments.notes', 'Notes')}
                </Label>
                <Textarea
                  id="shipment-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t('sales.documents.shipments.items', 'Items to ship')}
              </p>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('sales.documents.shipments.noLines', 'No order lines available.')}
                </p>
              ) : (
                <div className="space-y-2 rounded-lg border p-3">
                  {lines.map((line) => {
                    const available = computeAvailable(line.id, editingId)
                    const value = form.items[line.id] ?? ''
                    const errorMessage = formErrors[line.id]
                    const disabled = available <= 0 && !value
                    return (
                      <div
                        key={line.id}
                        className={cn(
                          'grid gap-2 md:grid-cols-[1fr,140px]',
                          disabled ? 'opacity-60' : null
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
                            value={value}
                            disabled={disabled}
                            onChange={(event) => {
                              const next = event.target.value
                              setForm((prev) => ({
                                ...prev,
                                items: { ...prev.items, [line.id]: next },
                              }))
                              setFormErrors((prev) => ({ ...prev, [line.id]: undefined }))
                            }}
                          />
                          {errorMessage ? (
                            <p className="text-xs text-destructive">{errorMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="shipment-address"
                  checked={form.attachAddress}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, attachAddress: Boolean(checked) }))
                  }
                  disabled={!shippingAddressSnapshot}
                />
                <Label htmlFor="shipment-address" className="cursor-pointer">
                  {t('sales.documents.shipments.attachAddress', 'Attach address snapshot')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="shipment-comment"
                  checked={form.postComment}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, postComment: Boolean(checked) }))
                  }
                />
                <Label htmlFor="shipment-comment" className="cursor-pointer">
                  {t('sales.documents.shipments.addComment', 'Add note to comments')}
                </Label>
              </div>
            </div>

            {submitError ? <ErrorMessage label={submitError} /> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              {t('sales.documents.shipments.cancel', 'Cancel')}
            </Button>
            <Button onClick={(event) => void handleSubmit(event)} disabled={saving || lines.length === 0}>
              {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingId
                ? t('sales.documents.shipments.save', 'Save changes')
                : t('sales.documents.shipments.create', 'Create shipment')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
