export type CrmAlertType =
  | 'no_recent_activity'
  | 'overdue_reorder'
  | 'stalled_deals'
  | 'declining_purchases'
  | 'overdue_activities'

export type CrmAlert = {
  type: CrmAlertType
  severity: 'warning' | 'error'
  tab?: string
}

export function computeCrmAlerts(params: {
  daysSinceLastActivity: number | null
  expectedOrderIntervalDays: number | null
  daysSinceLastOrder: number | null
  stalledDealCount: number
  purchaseTrend: 'stable' | 'growing' | 'declining' | null
  overdueActivityCount: number
}): CrmAlert[] {
  const alerts: CrmAlert[] = []

  if (params.daysSinceLastActivity !== null && params.daysSinceLastActivity > 30) {
    alerts.push({
      type: 'no_recent_activity',
      severity: params.daysSinceLastActivity > 60 ? 'error' : 'warning',
      tab: 'activities',
    })
  }

  if (
    params.expectedOrderIntervalDays !== null &&
    params.daysSinceLastOrder !== null &&
    params.daysSinceLastOrder > params.expectedOrderIntervalDays * 1.2
  ) {
    alerts.push({
      type: 'overdue_reorder',
      severity: 'warning',
      tab: 'purchase-history',
    })
  }

  if (params.stalledDealCount > 0) {
    alerts.push({
      type: 'stalled_deals',
      severity: params.stalledDealCount > 2 ? 'error' : 'warning',
      tab: 'deals',
    })
  }

  if (params.purchaseTrend === 'declining') {
    alerts.push({
      type: 'declining_purchases',
      severity: 'warning',
      tab: 'purchase-history',
    })
  }

  if (params.overdueActivityCount > 0) {
    alerts.push({
      type: 'overdue_activities',
      severity: params.overdueActivityCount > 3 ? 'error' : 'warning',
      tab: 'activities',
    })
  }

  return alerts
}
