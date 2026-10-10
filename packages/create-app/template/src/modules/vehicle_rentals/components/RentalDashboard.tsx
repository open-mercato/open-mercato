"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatRentalAmount } from './rentalOptions'
import { LIST_HREF } from './rentalListMeta'

export type RentalDashboardSummary = {
  draftRentals: number
  activeRentals: number
  dueBack: number
  completedThisMonth: number
  monthGross: string
  monthExtraKmNet: string
}

const EMPTY: RentalDashboardSummary = {
  draftRentals: 0,
  activeRentals: 0,
  dueBack: 0,
  completedThisMonth: 0,
  monthGross: '0',
  monthExtraKmNet: '0',
}

export default function RentalDashboard() {
  const t = useT()
  const query = useQuery({
    queryKey: ['rental-dashboard-summary'],
    queryFn: async (): Promise<RentalDashboardSummary> => {
      const call = await apiCall<RentalDashboardSummary>('/api/vehicle_rentals/dashboard-summary')
      return call.result ?? EMPTY
    },
    refetchInterval: 60 * 1000,
  })

  if (query.isLoading) {
    return <Page><PageBody><LoadingMessage label={t('vehicle_rentals.dashboard.loading', 'Loading rental summary…')} /></PageBody></Page>
  }

  const summary = query.data ?? EMPTY
  const tiles: Array<{ key: keyof RentalDashboardSummary; labelKey: string; fallback: string; href?: string }> = [
    { key: 'activeRentals', labelKey: 'vehicle_rentals.dashboard.activeRentals', fallback: 'On hire', href: `${LIST_HREF}?status=active` },
    { key: 'dueBack', labelKey: 'vehicle_rentals.dashboard.dueBack', fallback: 'Due back', href: `${LIST_HREF}?status=active` },
    { key: 'draftRentals', labelKey: 'vehicle_rentals.dashboard.draftRentals', fallback: 'Draft rentals', href: `${LIST_HREF}?status=draft` },
    { key: 'completedThisMonth', labelKey: 'vehicle_rentals.dashboard.completedThisMonth', fallback: 'Completed this month', href: `${LIST_HREF}?status=completed` },
  ]

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('vehicle_rentals.dashboard.title', 'Rental overview')}
          description={t('vehicle_rentals.dashboard.description', 'What is out on hire, what is due back, and what this month’s rentals earned.')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <KpiCard
              key={tile.key}
              title={t(tile.labelKey, tile.fallback)}
              value={Number(summary[tile.key])}
              headerAction={tile.href ? (
                <Link href={tile.href} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                  {t('vehicle_rentals.dashboard.view', 'View')}
                </Link>
              ) : undefined}
            />
          ))}
          <KpiCard
            title={t('vehicle_rentals.dashboard.monthGross', 'Revenue this month (gross)')}
            value={Number(summary.monthGross)}
            formatValue={(value) => formatRentalAmount(value)}
          />
          <KpiCard
            title={t('vehicle_rentals.dashboard.monthExtraKm', 'Extra mileage (net)')}
            value={Number(summary.monthExtraKmNet)}
            formatValue={(value) => formatRentalAmount(value)}
          />
        </div>
      </PageBody>
    </Page>
  )
}
