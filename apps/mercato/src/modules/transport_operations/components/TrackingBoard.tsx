"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

const TrackingMap = dynamic(() => import('./TrackingMap'), { ssr: false })

type DriverAlert = {
  id: string
  driverId: string
  driverName?: string | null
  tripId?: string | null
  orderId?: string | null
  latitude?: number | null
  longitude?: number | null
  note?: string | null
  createdAt: string
}

type TrackingItem = {
  vehicleId: string
  plateNumber: string
  make: string
  model: string
  vehicleType?: string | null
  status: string
  position: {
    latitude: number
    longitude: number
    speedKph?: number | null
    heading?: number | null
    recordedAt?: string | null
  } | null
  driverId?: string | null
  driverName?: string | null
  activeTrip: {
    id: string
    tripNumber: string
    origin: string
    destination: string
    executionStatus: string
    late: boolean
  } | null
}

export default function TrackingBoard() {
  const t = useT()
  const query = useQuery({
    queryKey: ['transport-tracking-board'],
    queryFn: async () => {
      const call = await apiCall<{ items?: TrackingItem[]; alerts?: DriverAlert[] }>('/api/transport_operations/tracking')
      return { items: call.result?.items ?? [], alerts: call.result?.alerts ?? [] }
    },
    refetchInterval: 15_000,
  })

  const items = query.data?.items ?? []
  const alerts = query.data?.alerts ?? []
  const positioned = items.flatMap((item) =>
    item.position
      ? [{
          vehicleId: item.vehicleId,
          plateNumber: item.plateNumber,
          driverName: item.driverName,
          activeTrip: item.activeTrip,
          position: item.position,
        }]
      : [],
  )
  const activeTrips = items.filter((item) => item.activeTrip).length

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('transport_operations.tracking.title', 'Live fleet tracking')}
          description={t(
            'transport_operations.tracking.description',
            'Latest telematics position and the active freight trip for each vehicle. Refreshes every 15 seconds.',
          )}
          actions={(
            <Button type="button" variant="outline" onClick={() => { void query.refetch() }}>
              {t('common.refresh', 'Refresh')}
            </Button>
          )}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('transport_operations.tracking.vehicles', 'Vehicles')}</p>
            <p className="text-2xl font-semibold text-foreground">{items.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('transport_operations.tracking.positioned', 'With position')}</p>
            <p className="text-2xl font-semibold text-foreground">{positioned.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('transport_operations.tracking.activeTrips', 'Active trips')}</p>
            <p className="text-2xl font-semibold text-foreground">{activeTrips}</p>
          </div>
        </div>

        {alerts.length ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t('transport_operations.tracking.alerts', 'Driver alerts')}
              </h2>
              <Badge variant="error">{alerts.length}</Badge>
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {alerts.map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {t('transport_operations.tracking.alertSos', 'SOS')} · {alert.driverName ?? alert.driverId}
                    </span>
                    {alert.note ? <span className="text-sm text-foreground">{alert.note}</span> : null}
                    {alert.latitude !== null && alert.latitude !== undefined && alert.longitude !== null && alert.longitude !== undefined ? (
                      <span className="text-xs text-muted-foreground">
                        {alert.latitude.toFixed(5)}, {alert.longitude.toFixed(5)}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(alert.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="relative">
          <TrackingMap vehicles={positioned} />
          {positioned.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded-md border border-border bg-background/90 px-3 py-2 text-sm text-muted-foreground">
                {t('transport_operations.tracking.noPositions', 'No vehicle positions have been received yet.')}
              </p>
            </div>
          ) : null}
        </div>

        <DataTable<TrackingItem>
          title={t('transport_operations.tracking.tableTitle', 'Fleet positions')}
          columns={[
            {
              id: 'plate',
              header: t('transport_operations.tracking.columns.vehicle', 'Vehicle'),
              accessorFn: (row) => row.plateNumber,
              cell: ({ row }) => (
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{row.original.plateNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {[row.original.make, row.original.model, row.original.vehicleType].filter(Boolean).join(' · ')}
                  </span>
                </span>
              ),
            },
            {
              id: 'driver',
              header: t('transport_operations.tracking.columns.driver', 'Driver'),
              accessorFn: (row) => row.driverName ?? '',
              cell: ({ row }) => <span className="text-sm">{row.original.driverName ?? '—'}</span>,
            },
            {
              id: 'trip',
              header: t('transport_operations.tracking.columns.trip', 'Active trip'),
              accessorFn: (row) => row.activeTrip?.tripNumber ?? '',
              cell: ({ row }) => (
                row.original.activeTrip ? (
                  <span className="flex flex-col">
                    <span className="text-sm">{row.original.activeTrip.tripNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.original.activeTrip.origin} → {row.original.activeTrip.destination}
                    </span>
                  </span>
                ) : <span className="text-sm text-muted-foreground">—</span>
              ),
            },
            {
              id: 'speed',
              header: t('transport_operations.tracking.columns.speed', 'Speed'),
              accessorFn: (row) => row.position?.speedKph ?? '',
              cell: ({ row }) => (
                <span className="text-sm">
                  {row.original.position?.speedKph !== undefined && row.original.position?.speedKph !== null
                    ? `${row.original.position.speedKph} km/h`
                    : '—'}
                </span>
              ),
            },
            {
              id: 'recorded',
              header: t('transport_operations.tracking.columns.lastSeen', 'Last seen'),
              accessorFn: (row) => row.position?.recordedAt ?? '',
              cell: ({ row }) => (
                <span className="text-sm">
                  {row.original.position?.recordedAt ? formatDateTime(row.original.position.recordedAt) : '—'}
                </span>
              ),
            },
            {
              id: 'status',
              header: t('transport_operations.tracking.columns.status', 'Status'),
              accessorFn: (row) => row.activeTrip?.executionStatus ?? row.status,
              cell: ({ row }) => (
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variant="secondary">
                    {(row.original.activeTrip?.executionStatus ?? row.original.status).replaceAll('_', ' ')}
                  </Badge>
                  {row.original.activeTrip?.late ? (
                    <Badge variant="warning">{t('transport_operations.tracking.late', 'Late')}</Badge>
                  ) : null}
                </span>
              ),
            },
          ]}
          data={items}
          isLoading={query.isLoading}
        />
      </PageBody>
    </Page>
  )
}
