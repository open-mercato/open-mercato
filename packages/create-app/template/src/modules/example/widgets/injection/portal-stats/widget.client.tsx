"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'

const STATS = [
  { label: 'example.portal.dashboard.accountOverview.orders.label', value: '12', trend: 'example.portal.dashboard.accountOverview.orders.trend', color: 'text-emerald-600 dark:text-emerald-400' },
  { label: 'example.portal.dashboard.accountOverview.pending.label', value: '2', trend: 'example.portal.dashboard.accountOverview.pending.trend', color: 'text-amber-600 dark:text-amber-400' },
  { label: 'example.portal.dashboard.accountOverview.invoices.label', value: '8', trend: 'example.portal.dashboard.accountOverview.invoices.trend', color: 'text-blue-600 dark:text-blue-400' },
  { label: 'example.portal.dashboard.accountOverview.quotes.label', value: '4', trend: 'example.portal.dashboard.accountOverview.quotes.trend', color: 'text-violet-600 dark:text-violet-400' },
]

export default function PortalStatsWidget() {
  const t = useT()

  return (
    <div className="grid grid-cols-2 gap-4">
      {STATS.map((stat) => (
        <div key={t(stat.label)}>
          <p className="text-overline font-semibold uppercase tracking-wider text-muted-foreground/60">
            {t(stat.label)}
          </p>
          <p className={`mt-0.5 text-2xl font-bold tracking-tight ${stat.color}`}>
            {stat.value}
          </p>
          <p className="mt-0.5 text-overline text-muted-foreground">{t(stat.trend)}</p>
        </div>
      ))}
    </div>
  )
}
