"use client"

import * as React from 'react'
import { match } from 'ts-pattern'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type CarrierShipmentRef = {
  shipmentId: string
  providerKey: string
  trackingNumber: string
  status: string
}

type TrackingEvent = {
  status: string
  occurredAt: string
  location?: string
}

type TrackingResult = {
  status: string
  trackingNumber: string
  events: TrackingEvent[]
}

type SalesShipment = {
  id: string
  orderId: string
  _carrier?: CarrierShipmentRef
}

type WidgetContext = {
  resourceId?: string
  resourceKind?: string
  record?: Record<string, unknown>
}

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'no_shipment' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; tracking: TrackingResult }

export default function InpostTrackingWidget({ context }: InjectionWidgetComponentProps) {
  const t = useT()
  const [fetchState, setFetchState] = React.useState<FetchState>({ kind: 'idle' })

  const ctx = context as WidgetContext
  const orderId = typeof ctx?.resourceId === 'string' ? ctx.resourceId : null

  const loadTracking = React.useCallback(async () => {
    if (!orderId) return
    setFetchState({ kind: 'loading' })

    const shipmentsRes = await apiCall<{ items?: SalesShipment[] }>(
      `/api/sales/shipments?orderId=${orderId}&pageSize=50`,
    )
    if (!shipmentsRes.ok) {
      setFetchState({ kind: 'error', message: t('carrier_inpost.tracking.errorLoadShipments', 'Failed to load shipments') })
      return
    }
    const shipments: SalesShipment[] = shipmentsRes.result?.items ?? []
    const inpostShipment = shipments.find((s) => s._carrier?.providerKey === 'inpost')

    if (!inpostShipment?._carrier) {
      setFetchState({ kind: 'no_shipment' })
      return
    }

    const { shipmentId } = inpostShipment._carrier
    const trackingRes = await apiCall<TrackingResult>(
      `/api/shipping-carriers/tracking?providerKey=inpost&shipmentId=${shipmentId}`,
    )
    if (!trackingRes.ok) {
      setFetchState({ kind: 'error', message: t('carrier_inpost.tracking.errorFetch', 'Failed to fetch tracking info') })
      return
    }
    const tracking = trackingRes.result
    if (!tracking) {
      setFetchState({ kind: 'error', message: t('carrier_inpost.tracking.errorFetch', 'Failed to fetch tracking info') })
      return
    }
    setFetchState({ kind: 'success', tracking })
  }, [orderId, t])

  React.useEffect(() => {
    if (orderId) {
      loadTracking()
    }
  }, [orderId, loadTracking])

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {t('carrier_inpost.tracking.title', 'InPost Tracking')}
        </p>
        {match(fetchState)
          .with({ kind: 'success' }, ({ tracking }) => (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {tracking.status}
            </span>
          ))
          .otherwise(() => null)}
      </div>

      {match(fetchState)
        .with({ kind: 'idle' }, () => null)
        .with({ kind: 'loading' }, () => (
          <p className="text-sm text-muted-foreground">
            {t('carrier_inpost.tracking.loading', 'Loading tracking...')}
          </p>
        ))
        .with({ kind: 'no_shipment' }, () => (
          <p className="text-sm text-muted-foreground">
            {t('carrier_inpost.tracking.noShipment', 'No InPost shipment found for this order.')}
          </p>
        ))
        .with({ kind: 'error' }, ({ message }) => (
          <p className="text-sm text-destructive">{message}</p>
        ))
        .with({ kind: 'success' }, ({ tracking }) => (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('carrier_inpost.tracking.trackingNumber', 'Tracking number')}: {tracking.trackingNumber}
            </p>
            {tracking.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('carrier_inpost.tracking.noEvents', 'No tracking events yet.')}
              </p>
            ) : (
              <ol className="space-y-2">
                {tracking.events.map((event, index) => (
                  <li key={index} className="flex gap-3 text-sm">
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                    <span className="font-medium">{event.status}</span>
                    {event.location ? (
                      <span className="text-muted-foreground">{event.location}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))
        .exhaustive()}
    </div>
  )
}
