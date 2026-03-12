import { evaluateAlerts, type AlertRule } from '@open-mercato/shared/lib/scoring/alerts'

// Re-export types for BC
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

type CrmAlertParams = {
  daysSinceLastActivity: number | null
  expectedOrderIntervalDays: number | null
  daysSinceLastOrder: number | null
  stalledDealCount: number
  purchaseTrend: 'stable' | 'growing' | 'declining' | null
  overdueActivityCount: number
}

// CRM-specific alert rules using the generic framework
const crmAlertRules: AlertRule<CrmAlertParams>[] = [
  {
    type: 'no_recent_activity',
    condition: (params) => params.daysSinceLastActivity !== null && params.daysSinceLastActivity > 30,
    severity: (params) => (params.daysSinceLastActivity ?? 0) > 60 ? 'error' : 'warning',
    tab: 'activities',
  },
  {
    type: 'overdue_reorder',
    condition: (params) =>
      params.expectedOrderIntervalDays !== null &&
      params.daysSinceLastOrder !== null &&
      params.daysSinceLastOrder > params.expectedOrderIntervalDays * 1.2,
    severity: () => 'warning',
    tab: 'purchase-history',
  },
  {
    type: 'stalled_deals',
    condition: (params) => params.stalledDealCount > 0,
    severity: (params) => params.stalledDealCount > 2 ? 'error' : 'warning',
    tab: 'deals',
  },
  {
    type: 'declining_purchases',
    condition: (params) => params.purchaseTrend === 'declining',
    severity: () => 'warning',
    tab: 'purchase-history',
  },
  {
    type: 'overdue_activities',
    condition: (params) => params.overdueActivityCount > 0,
    severity: (params) => params.overdueActivityCount > 3 ? 'error' : 'warning',
    tab: 'activities',
  },
]

export function computeCrmAlerts(params: CrmAlertParams): CrmAlert[] {
  const alerts = evaluateAlerts(crmAlertRules, params)
  return alerts.map((alert) => ({
    type: alert.type as CrmAlertType,
    severity: alert.severity as 'warning' | 'error',
    tab: alert.tab,
  }))
}
