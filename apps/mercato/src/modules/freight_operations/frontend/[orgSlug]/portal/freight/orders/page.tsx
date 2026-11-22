"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { PortalOrderDialog } from '../../../../../components/PortalOrderDialog'
import { RateDriverDialog } from '../../../../../components/RateDriverDialog'

type Props = { params: { orgSlug: string } }

type OrderRow = {
  id: string
  orderNumber: string
  status: string
  cargoDescription: string
  pickupLocation: string
  dropoffLocation: string
  requestedPickupAt: string | null
  requestedDeliveryAt: string | null
  submittedAt: string | null
  driverRating?: { rating: number | null; comment: string | null } | null
  createdAt: string
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (status === 'delivered' || status === 'completed' || status === 'invoiced') return 'success'
  if (status === 'assigned' || status === 'in_transit') return 'warning'
  if (status === 'cancelled') return 'error'
  if (status === 'submitted' || status === 'confirmed') return 'info'
  return 'neutral'
}

export default function PortalFreightOrdersPage({ params }: Props) {
  const t = useT()
  const [rows, setRows] = React.useState<OrderRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [rateOrder, setRateOrder] = React.useState<{ id: string; orderNumber: string } | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const response = await apiCall<{ items?: OrderRow[] }>('/api/portal/freight/orders')
    if (response.ok && response.result) {
      setRows(Array.isArray(response.result.items) ? response.result.items : [])
    } else {
      setError(t('freight_operations.portal.orders.loadError', 'Failed to load your transport orders.'))
    }
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        label={t('freight_operations.portal.orders.title', 'Transport orders')}
        title={t('freight_operations.portal.orders.heading', 'Your shipments')}
        action={(
          <Button type="button" onClick={() => setDialogOpen(true)}>
            {t('freight_operations.portal.orders.create', 'Request an order')}
          </Button>
        )}
      />
      {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
      <DataTable<OrderRow>
        title={t('freight_operations.portal.orders.title', 'Transport orders')}
        columns={[
          {
            id: 'number',
            header: t('freight_operations.portal.orders.number', 'Order'),
            accessorFn: (row) => row.orderNumber,
          },
          {
            id: 'status',
            header: t('freight_operations.portal.orders.status', 'Status'),
            accessorFn: (row) => row.status,
            cell: ({ row }) => (
              <StatusBadge variant={statusVariant(row.original.status)}>
                {t(
                  `freight_operations.portal.orders.status.${row.original.status}`,
                  row.original.status.replaceAll('_', ' '),
                )}
              </StatusBadge>
            ),
          },
          {
            id: 'lane',
            header: t('freight_operations.portal.orders.lane', 'Lane'),
            accessorFn: (row) => `${row.pickupLocation} → ${row.dropoffLocation}`,
          },
          {
            id: 'cargo',
            header: t('freight_operations.portal.orders.cargo', 'Cargo'),
            accessorFn: (row) => row.cargoDescription,
            meta: { truncate: true, maxWidth: '18rem' },
          },
          {
            id: 'pickup',
            header: t('freight_operations.portal.orders.requestedPickup', 'Requested pickup'),
            accessorFn: (row) => row.requestedPickupAt ?? '',
            cell: ({ row }) => (
              <span className="text-sm">
                {row.original.requestedPickupAt
                  ? formatDateTime(row.original.requestedPickupAt)
                  : '—'}
              </span>
            ),
          },
          {
            id: 'rating',
            header: t('freight_operations.portal.orders.ratingColumn', 'Driver rating'),
            accessorFn: (row) => row.driverRating?.rating ?? 0,
            cell: ({ row }) => {
              const existing = row.original.driverRating?.rating
              if (existing) return <Rating value={existing} size="sm" />
              const canRate = ['delivered', 'completed', 'invoiced'].includes(row.original.status)
              return canRate ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRateOrder({ id: row.original.id, orderNumber: row.original.orderNumber })}
                >
                  {t('freight_operations.portal.orders.rate', 'Rate driver')}
                </Button>
              ) : <span className="text-sm text-muted-foreground">—</span>
            },
          },
          {
            id: 'submitted',
            header: t('freight_operations.portal.orders.submittedAt', 'Submitted'),
            accessorFn: (row) => row.submittedAt ?? row.createdAt,
            cell: ({ row }) => (
              <span className="text-sm">{formatDateTime(row.original.submittedAt ?? row.original.createdAt)}</span>
            ),
          },
        ]}
        data={rows}
        isLoading={loading}
        emptyState={t('freight_operations.portal.orders.empty', 'No transport orders yet.')}
        disableRowClick
      />
      <PortalOrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => { void load() }}
      />
      <RateDriverDialog
        order={rateOrder}
        onOpenChange={(open) => { if (!open) setRateOrder(null) }}
        onRated={() => {
          setRateOrder(null)
          void load()
        }}
      />
    </div>
  )
}
