"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Summary = {
  activeVehicles: number
  availableDrivers: number
  expiringDriverLicenses: number
  scheduledTrips: number
  tripsInProgress: number
}

export default function TransportDashboardPage() {
  const t = useT()
  const [summary, setSummary] = React.useState<Summary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    apiCall<Summary>('/api/transport_operations/dashboard-summary')
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          setSummary(response.result)
          return
        }
        setError(t('transport_operations.dashboard.error', 'Unable to load the transport summary.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('transport_operations.dashboard.error', 'Unable to load the transport summary.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{t('transport_operations.dashboard.title', 'Transport dashboard')}</h1>
          <div className="ms-auto flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/backend/transport/trips">{t('transport_operations.trips.page.title', 'Trips')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/backend/transport/vehicles">{t('transport_operations.vehicles.page.title', 'Vehicles')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/backend/fleet/operations">{t('fleet_operations.nav.group', 'Fleet operations')}</Link>
            </Button>
          </div>
        </div>
        {loading ? (
          <LoadingMessage label={t('transport_operations.dashboard.loading', 'Loading…')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : summary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label={t('transport_operations.dashboard.activeVehicles', 'Active vehicles')} value={summary.activeVehicles} />
            <Metric label={t('transport_operations.dashboard.availableDrivers', 'Available drivers')} value={summary.availableDrivers} />
            <Metric label={t('transport_operations.dashboard.expiringLicenses', 'Licences expiring')} value={summary.expiringDriverLicenses} />
            <Metric label={t('transport_operations.dashboard.scheduledTrips', 'Scheduled trips')} value={summary.scheduledTrips} />
            <Metric label={t('transport_operations.dashboard.inProgressTrips', 'Trips in progress')} value={summary.tripsInProgress} />
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  )
}
