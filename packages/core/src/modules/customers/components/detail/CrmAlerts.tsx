"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type CrmAlert = {
  type: string
  severity: 'warning' | 'error'
  tab?: string
}

const alertIcons: Record<string, string> = {
  warning: '⚠',
  error: '⛔',
}

export function CrmAlerts({
  alerts,
  onNavigateToTab,
}: {
  alerts: CrmAlert[]
  onNavigateToTab?: (tab: string) => void
}) {
  const t = useT()

  if (!alerts || alerts.length === 0) return null

  const alertMessages: Record<string, string> = {
    no_recent_activity: t('customers.companies.detail.alerts.noRecentActivity', 'No contact in over 30 days'),
    overdue_reorder: t('customers.companies.detail.alerts.overdueReorder', 'Expected reorder is overdue'),
    stalled_deals: t('customers.companies.detail.alerts.stalledDeals', 'Open deals past expected close date'),
    declining_purchases: t('customers.companies.detail.alerts.decliningPurchases', 'Purchase trend is declining'),
    overdue_activities: t('customers.companies.detail.alerts.overdueActivities', 'There are overdue activities'),
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert, index) => {
        const icon = alertIcons[alert.severity] ?? '⚠'
        const message = alertMessages[alert.type] ?? alert.type
        const bgColor = alert.severity === 'error'
          ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300'
          : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-300'

        return (
          <button
            key={`${alert.type}-${index}`}
            type="button"
            className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm ${bgColor} transition-colors hover:opacity-80`}
            onClick={() => alert.tab && onNavigateToTab?.(alert.tab)}
            disabled={!alert.tab}
          >
            <span>{icon}</span>
            <span>{message}</span>
          </button>
        )
      })}
    </div>
  )
}
