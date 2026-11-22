"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type TrackingStatus = {
  orderNumber: string
  status: string
  cargoDescription: string
  pickupLocation: string
  dropoffLocation: string
  requestedPickupAt?: string | null
  requestedDeliveryAt?: string | null
  deliveredAt?: string | null
  completedAt?: string | null
  driverName?: string | null
  vehiclePlate?: string | null
  deliveryNoteNumber?: string | null
  updatedAt?: string | null
}

const STEPS = ['draft', 'confirmed', 'assigned', 'in_transit', 'delivered', 'completed'] as const

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (status === 'delivered' || status === 'completed' || status === 'invoiced') return 'success'
  if (status === 'in_transit' || status === 'assigned') return 'warning'
  if (status === 'cancelled') return 'error'
  return 'info'
}

export default function PublicTrackingView({ token }: { token: string }) {
  const t = useT()
  const query = useQuery({
    queryKey: ['public-freight-tracking', token],
    queryFn: async () => {
      const call = await apiCall<TrackingStatus>(
        `/api/freight_operations/public/tracking?token=${encodeURIComponent(token)}`,
      )
      return { ok: call.ok, status: call.response.status, data: call.result }
    },
    refetchInterval: 30_000,
  })

  const result = query.data
  const notFound = result && !result.ok && result.status === 404

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-background p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {t('freight_operations.public_tracking.brand', 'Shipment tracking')}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">
          {t('freight_operations.public_tracking.title', 'Track your shipment')}
        </h1>
      </header>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {t('common.loading', 'Loading…')}
        </div>
      ) : query.isError || (result && !result.ok && !notFound) ? (
        <p className="text-sm text-status-error-text">
          {t('freight_operations.public_tracking.loadError', 'Unable to load the tracking status.')}
        </p>
      ) : notFound || !result?.data ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-foreground">
            {t('freight_operations.public_tracking.notFound', 'This tracking link is invalid or has expired.')}
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.order', 'Order')}</p>
                <p className="text-lg font-semibold text-foreground">{result.data.orderNumber}</p>
              </div>
              <Badge variant={statusVariant(result.data.status)}>
                {result.data.status.replaceAll('_', ' ')}
              </Badge>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.lane', 'Lane')}</dt>
                <dd className="font-medium text-foreground">{result.data.pickupLocation} → {result.data.dropoffLocation}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.cargo', 'Cargo')}</dt>
                <dd className="font-medium text-foreground">{result.data.cargoDescription}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.requestedPickup', 'Requested pickup')}</dt>
                <dd className="font-medium text-foreground">
                  {result.data.requestedPickupAt ? formatDateTime(result.data.requestedPickupAt) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.deliveredAt', 'Delivered at')}</dt>
                <dd className="font-medium text-foreground">
                  {result.data.deliveredAt ? formatDateTime(result.data.deliveredAt) : '—'}
                </dd>
              </div>
              {result.data.driverName ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.driver', 'Driver')}</dt>
                  <dd className="font-medium text-foreground">{result.data.driverName}</dd>
                </div>
              ) : null}
              {result.data.vehiclePlate ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.vehicle', 'Vehicle')}</dt>
                  <dd className="font-medium text-foreground">{result.data.vehiclePlate}</dd>
                </div>
              ) : null}
              {result.data.deliveryNoteNumber ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('freight_operations.public_tracking.deliveryNote', 'Delivery note')}</dt>
                  <dd className="font-medium text-foreground">{result.data.deliveryNoteNumber}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {result.data.status !== 'cancelled' ? (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">
                {t('freight_operations.public_tracking.progress', 'Progress')}
              </h2>
              <ol className="mt-3 flex flex-col gap-3">
                {STEPS.map((step) => {
                  const stepIndex = STEPS.indexOf(step)
                  const currentIndex = STEPS.indexOf(result.data?.status as (typeof STEPS)[number])
                  const reached = currentIndex >= stepIndex
                  return (
                    <li key={step} className="flex items-center gap-3 text-sm">
                      <span
                        aria-hidden
                        className={`size-2.5 rounded-full ${reached ? 'bg-status-success-solid' : 'bg-muted'}`}
                      />
                      <span className={reached ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                        {t(`freight_operations.public_tracking.step.${step}`, step.replaceAll('_', ' '))}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          ) : null}
        </>
      )}
      <footer className="mt-auto text-xs text-muted-foreground">
        {t(
          'freight_operations.public_tracking.footer',
          'This page shows the non-sensitive status of your shipment and refreshes automatically.',
        )}
      </footer>
    </main>
  )
}
