"use client"

import * as React from 'react'
import { Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { emitSalesDocumentTotalsRefresh } from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import type { SectionAction } from '@open-mercato/core/modules/customers/components/detail/types'
import { generateTempId } from '@open-mercato/core/modules/customers/lib/detailHelpers'
import { formatAddressString, type AddressValue } from '@open-mercato/core/modules/customers/utils/addressFormat'
import { ShipmentDialog } from './ShipmentDialog'
import { extractCustomFieldValues } from './customFieldHelpers'
import type { OrderLine, ShipmentRow, ShipmentItem } from './shipmentTypes'

const ADDRESS_SNAPSHOT_KEY = 'shipmentAddressSnapshot'
const ADDRESS_FORMAT: 'line_first' = 'line_first'

type SalesShipmentsSectionProps = {
  orderId: string
  currencyCode?: string | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  organizationId?: string | null
  tenantId?: string | null
  onActionChange?: (action: SectionAction | null) => void
  onAddComment?: (body: string) => Promise<void>
}

function formatDisplayDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

const formatShipmentAddress = (metadata?: Record<string, unknown> | null): string | null => {
  if (!metadata || typeof metadata !== 'object') return null
  const snapshot = (metadata as any)[ADDRESS_SNAPSHOT_KEY]
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const read = (key: string): string | null => {
    const value = (snapshot as any)[key]
    return typeof value === 'string' && value.trim().length ? value.trim() : null
  }
  const addressValue: AddressValue = {
    addressLine1: read('addressLine1') ?? read('address_line1'),
    addressLine2: read('addressLine2') ?? read('address_line2'),
    buildingNumber: read('buildingNumber') ?? read('building_number'),
    flatNumber: read('flatNumber') ?? read('flat_number'),
    city: read('city'),
    region: read('region'),
    postalCode: read('postalCode') ?? read('postal_code'),
    country: read('country'),
    companyName: read('companyName') ?? read('company_name'),
  }
  const summary = formatAddressString(addressValue, ADDRESS_FORMAT)
  return summary && summary.trim().length ? summary : null
}

const resolveLineThumbnail = (item: Record<string, unknown>): string | null => {
  const pickThumbnail = (...candidates: Array<unknown>): string | null => {
    const found = candidates.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    )
    return found ?? null
  }

  const metadata =
    typeof (item as any).metadata === 'object' && (item as any).metadata !== null
      ? ((item as any).metadata as Record<string, unknown>)
      : null
  const snapshot =
    typeof (item as any).catalog_snapshot === 'object' && (item as any).catalog_snapshot !== null
      ? ((item as any).catalog_snapshot as Record<string, unknown>)
      : null
  const productSnapshot =
    snapshot && typeof (snapshot as any).product === 'object' ? ((snapshot as any).product as Record<string, unknown>) : null
  const variantSnapshot =
    snapshot && typeof (snapshot as any).variant === 'object' ? ((snapshot as any).variant as Record<string, unknown>) : null

  const productThumb = pickThumbnail(
    metadata ? (metadata as any).productThumbnail : null,
    productSnapshot ? (productSnapshot as any).thumbnailUrl : null,
    productSnapshot ? (productSnapshot as any).thumbnail_url : null,
  )
  const variantThumb = pickThumbnail(
    metadata ? (metadata as any).variantThumbnail : null,
    variantSnapshot ? (variantSnapshot as any).thumbnailUrl : null,
    variantSnapshot ? (variantSnapshot as any).thumbnail_url : null,
  )

  const snapshotThumb = pickThumbnail(
    snapshot ? (snapshot as any).thumbnailUrl : null,
    snapshot ? (snapshot as any).thumbnail_url : null,
  )

  return variantThumb ?? productThumb ?? snapshotThumb ?? null
}

export function SalesShipmentsSection({
  orderId,
  currencyCode,
  shippingAddressSnapshot,
  organizationId: organizationIdProp,
  tenantId: tenantIdProp,
  onActionChange,
  onAddComment,
}: SalesShipmentsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const resolvedOrganizationId = organizationIdProp ?? organizationId ?? null
  const resolvedTenantId = tenantIdProp ?? tenantId ?? null
  const addShipmentLabel = React.useMemo(
    () => t('sales.documents.shipments.add', 'Add shipment'),
    [t]
  )
  const [shipments, setShipments] = React.useState<ShipmentRow[]>([])
  const [lines, setLines] = React.useState<OrderLine[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogState, setDialogState] = React.useState<{ mode: 'create' | 'edit'; shipment: ShipmentRow | null } | null>(null)

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
          thumbnail: resolveLineThumbnail(item as Record<string, unknown>),
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
          const snapshotItemsRaw = Array.isArray((item as any).items_snapshot)
            ? ((item as any).items_snapshot as Array<Record<string, unknown>>)
            : []
          const responseItems = Array.isArray((item as any).items)
            ? ((item as any).items as Array<Record<string, unknown>>)
            : []
          const itemsRaw = responseItems.length ? responseItems : snapshotItemsRaw
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
          const customValues = extractCustomFieldValues(item as Record<string, unknown>)
          return {
            id,
            shipmentNumber:
              typeof (item as any).shipment_number === 'string'
                ? (item as any).shipment_number
                : typeof (item as any).shipmentNumber === 'string'
                  ? (item as any).shipmentNumber
                  : null,
            shippingMethodId:
              typeof (item as any).shipping_method_id === 'string'
                ? (item as any).shipping_method_id
                : typeof (item as any).shippingMethodId === 'string'
                  ? (item as any).shippingMethodId
                  : null,
            shippingMethodCode:
              typeof (item as any).shipping_method_code === 'string'
                ? (item as any).shipping_method_code
                : typeof (item as any).shippingMethodCode === 'string'
                  ? (item as any).shippingMethodCode
                  : null,
            shippingMethodName:
              typeof (item as any).shipping_method_name === 'string'
                ? (item as any).shipping_method_name
                : typeof (item as any).shippingMethodName === 'string'
                  ? (item as any).shippingMethodName
                  : null,
            status:
              typeof item.status === 'string'
                ? item.status
                : typeof (item as any).status === 'string'
                  ? (item as any).status
                  : null,
            statusLabel:
              typeof (item as any).status_label === 'string'
                ? (item as any).status_label
                : typeof (item as any).statusLabel === 'string'
                  ? (item as any).statusLabel
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
            customValues: Object.keys(customValues).length ? customValues : null,
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

  const handleOpenCreate = React.useCallback(() => {
    setDialogState({ mode: 'create', shipment: null })
  }, [])

  React.useEffect(() => {
    if (!onActionChange) return
    if (shipments.length === 0) {
      onActionChange(null)
      return
    }
    onActionChange({
      label: addShipmentLabel,
      onClick: handleOpenCreate,
      disabled: loading,
    })
    return () => onActionChange(null)
  }, [addShipmentLabel, handleOpenCreate, loading, onActionChange, shipments.length])

  const handleEdit = React.useCallback((shipment: ShipmentRow) => {
    setDialogState({ mode: 'edit', shipment })
  }, [])

  const handleDelete = React.useCallback(
    async (shipment: ShipmentRow) => {
      const confirmed = window.confirm(
        t('sales.documents.shipments.confirmDelete', 'Delete this shipment?')
      )
      if (!confirmed) return
      try {
        const result = await deleteCrud('sales/shipments', {
          body: {
            id: shipment.id,
            orderId,
            organizationId: resolvedOrganizationId,
            tenantId: resolvedTenantId,
          },
          errorMessage: t('sales.documents.shipments.errorDelete', 'Failed to delete shipment.'),
        })
        if (result.ok) {
          await loadShipments()
          emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
        }
      } catch (err) {
        console.error('sales.shipments.delete', err)
        flash(t('sales.documents.shipments.errorDelete', 'Failed to delete shipment.'), 'error')
      }
    },
    [loadShipments, orderId, resolvedOrganizationId, resolvedTenantId, t]
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
    return (
      <LoadingMessage
        label={t('sales.documents.shipments.loading', 'Loading shipments…')}
        className="border-0 bg-transparent p-0 py-8 justify-center"
      />
    )
  }

  if (error) {
    return <ErrorMessage label={error} />
  }

  const empty = !shipments.length

  return (
    <div className="space-y-4">
      {empty ? (
        <TabEmptyState
          title={t('sales.documents.shipments.empty.title', 'No shipments yet.')}
          description={t(
            'sales.documents.shipments.empty.description',
            'Add shipments for this document to let the user track the order.'
          )}
          action={{
            label: addShipmentLabel,
            onClick: handleOpenCreate,
            icon: <Plus className="h-4 w-4" aria-hidden />,
            disabled: loading,
          }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shipments.map((shipment) => {
            const shippedAt = formatDisplayDate(shipment.shippedAt)
            const deliveredAt = formatDisplayDate(shipment.deliveredAt)
            const addressSummary = formatShipmentAddress(shipment.metadata)
            const statusLabel =
              shipment.statusLabel ??
              shipment.status ??
              t('sales.documents.shipments.statusMissing', 'Status pending')
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
                        {statusLabel}
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
                  {addressSummary ? (
                    <p className="text-xs text-muted-foreground">{addressSummary}</p>
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

      <ShipmentDialog
        open={dialogState !== null}
        mode={dialogState?.mode ?? 'create'}
        shipment={dialogState?.shipment ?? null}
        lines={lines}
        orderId={orderId}
        currencyCode={currencyCode}
        organizationId={resolvedOrganizationId}
        tenantId={resolvedTenantId}
        computeAvailable={computeAvailable}
        shippingAddressSnapshot={shippingAddressSnapshot}
        onClose={() => setDialogState(null)}
        onSaved={async () => {
          await loadShipments()
          emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
          setDialogState(null)
        }}
        onAddComment={onAddComment}
      />
    </div>
  )
}
