"use client"

import * as React from 'react'
import { EyeOff } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard, type KpiTrend } from '@open-mercato/ui/backend/charts/KpiCard'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { InlineActivityComposer } from './InlineActivityComposer'
import type { CompanyOverview } from '../formConfig'
import { formatCurrency } from './utils'
import { computeHealthScore } from './healthScoreUtils'
import {
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
  removeLocalStorageKey,
} from '@open-mercato/shared/lib/browser/safeLocalStorage'
import {
  sumActiveDeals,
  getActiveDeals,
  getOpenTasks,
  getUpcomingMeetings,
  getRecentActivity,
  computeActivityTrend,
  computeDealTrend,
} from './dashboard/helpers'
import { UpcomingMeetingsWidget } from './dashboard/UpcomingMeetingsWidget'
import { RelationshipHealthWidget } from './dashboard/RelationshipHealthWidget'
import { ActiveDealWidget } from './dashboard/ActiveDealWidget'
import { OpenTasksWidget } from './dashboard/OpenTasksWidget'
import { RecentActivityWidget } from './dashboard/RecentActivityWidget'

type GuardedMutationRunner = <T>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type CompanyDashboardTabProps = {
  data: CompanyOverview
  companyId: string
  onTabChange: (tab: string) => void
  onActivityCreated?: () => void
  onScheduleRequested?: () => void
  runGuardedMutation?: GuardedMutationRunner
  useCanonicalInteractions?: boolean
}

export function CompanyDashboardTab({ data, companyId, onTabChange, onActivityCreated, onScheduleRequested, runGuardedMutation, useCanonicalInteractions }: CompanyDashboardTabProps) {
  const t = useT()

  const activeDeals = React.useMemo(() => getActiveDeals(data.deals), [data.deals])
  const activeDealsValue = React.useMemo(() => sumActiveDeals(data.deals), [data.deals])
  const openTasks = React.useMemo(() => getOpenTasks(data.todos), [data.todos])
  const upcomingMeetings = React.useMemo(() => getUpcomingMeetings(data.interactions), [data.interactions])
  const recentActivity = React.useMemo(() => getRecentActivity(data.interactions), [data.interactions])

  const dealCurrency = activeDeals[0]?.valueCurrency ?? data.deals[0]?.valueCurrency ?? 'PLN'
  const activityTrend = React.useMemo(() => computeActivityTrend(data.interactions), [data.interactions])
  const dealTrend = React.useMemo(() => computeDealTrend(data.deals), [data.deals])
  const healthScore = React.useMemo(() => computeHealthScore(data.interactions), [data.interactions])

  const ltvValue = React.useMemo(() => {
    const wonDeals = data.deals.filter((d) => d.status === 'won')
    if (wonDeals.length === 0) return null
    return wonDeals.reduce((sum, d) => {
      const amt = typeof d.valueAmount === 'number' ? d.valueAmount : parseFloat(String(d.valueAmount ?? '0'))
      return sum + (Number.isFinite(amt) ? amt : 0)
    }, 0)
  }, [data.deals])

  const clientTenureYears = React.useMemo(() => {
    const allDates = data.interactions
      .map((i) => i.occurredAt ?? i.scheduledAt ?? i.createdAt)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
    if (allDates.length === 0) return null
    const earliest = Math.min(...allDates)
    return Math.floor((Date.now() - earliest) / (365.25 * 86_400_000))
  }, [data.interactions])

  const [hiddenTiles, setHiddenTiles] = React.useState<Set<string>>(
    () => new Set(readJsonFromLocalStorage<string[]>('om:dashboard-hidden-tiles', [])),
  )

  const toggleTile = React.useCallback((tileId: string) => {
    setHiddenTiles((prev) => {
      const next = new Set(prev)
      if (next.has(tileId)) next.delete(tileId)
      else next.add(tileId)
      writeJsonToLocalStorage('om:dashboard-hidden-tiles', [...next])
      return next
    })
  }, [])

  const kpiTiles: Array<{ id: string; title: string; value: number | null; trend?: KpiTrend; formatValue?: (v: number) => string; comparisonLabel: string }> = [
    { id: 'activeDeals', title: t('customers.companies.dashboard.kpi.activeDeals', 'ACTIVE DEALS'), value: activeDealsValue, trend: dealTrend, formatValue: (v: number) => formatCurrency(v, dealCurrency), comparisonLabel: `${activeDeals.length} ${activeDeals.length === 1 ? 'pipeline' : 'pipelines'}` },
    { id: 'activities', title: t('customers.companies.dashboard.kpi.activities', 'ACTIVITIES'), value: data.interactions.length, trend: activityTrend, comparisonLabel: t('customers.companies.dashboard.kpi.last12months', 'last 12 months') },
    { id: 'ltv', title: t('customers.companies.dashboard.kpi.ltv', 'CUSTOMER VALUE (LTV)'), value: ltvValue, formatValue: ltvValue !== null ? (v: number) => formatCurrency(v, dealCurrency) : undefined, comparisonLabel: ltvValue !== null ? t('customers.companies.dashboard.kpi.wonDeals', 'won deals total') : t('customers.companies.dashboard.kpi.noWonDeals', 'No won deals') },
    { id: 'clientSince', title: t('customers.companies.dashboard.kpi.clientSince', 'CLIENT SINCE'), value: clientTenureYears, formatValue: clientTenureYears !== null ? (v: number) => v < 1 ? `< 1 ${t('customers.companies.dashboard.kpi.year', 'year')}` : `${v} ${v === 1 ? t('customers.companies.dashboard.kpi.year', 'year') : t('customers.companies.dashboard.kpi.years', 'years')}` : undefined, comparisonLabel: clientTenureYears !== null ? `${data.deals.filter(d => d.status === 'won').length} ${t('customers.companies.dashboard.kpi.completedDeals', 'completed deals')}` : t('customers.companies.dashboard.kpi.noInteractions', 'No interactions yet') },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiTiles.filter((tile) => !hiddenTiles.has(tile.id)).map((tile) => (
          <div key={tile.id} className="relative group">
            <KpiCard
              title={tile.title}
              value={tile.value}
              trend={tile.trend}
              formatValue={tile.formatValue}
              comparisonLabel={tile.comparisonLabel}
            />
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => toggleTile(tile.id)}
              className="h-auto absolute top-2 right-2 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground hover:text-foreground p-0"
              aria-label={t('customers.companies.dashboard.hideTile', 'Hide tile')}
            >
              <EyeOff className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
      {hiddenTiles.size > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('customers.companies.dashboard.hiddenTiles', '{{count}} tiles hidden', { count: hiddenTiles.size })}
          </span>
          <Button type="button" variant="ghost" size="sm" className="h-auto text-xs px-1.5 py-0.5" onClick={() => { setHiddenTiles(new Set()); removeLocalStorageKey('om:dashboard-hidden-tiles') }}>
            {t('customers.companies.dashboard.showAll', 'Show all')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <UpcomingMeetingsWidget meetings={upcomingMeetings} t={t} />
          <OpenTasksWidget tasks={openTasks} t={t} onViewAll={() => onTabChange('activity-log')} currentUserId={null} />
        </div>
        <div className="space-y-6">
          <RelationshipHealthWidget health={healthScore} t={t} />
          <ActiveDealWidget deals={activeDeals} t={t} />
        </div>
      </div>

      <InlineActivityComposer
        entityType="company"
        entityId={companyId}
        onActivityCreated={onActivityCreated}
        runGuardedMutation={runGuardedMutation}
        onScheduleRequested={onScheduleRequested}
        useCanonicalInteractions={useCanonicalInteractions}
      />

      <RecentActivityWidget interactions={recentActivity} t={t} />
    </div>
  )
}
