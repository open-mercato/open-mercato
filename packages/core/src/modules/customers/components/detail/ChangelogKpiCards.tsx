'use client'

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ChangelogKpiCardsProps = {
  loading?: boolean
  totalCount: number
  todayCount: number
  yesterdayCount: number
  uniqueUsers: number
  criticalFieldCount: number
  criticalFieldLabel: string
  dateRangeDays: number
}

type MetricCardProps = {
  title: string
  value: number
  subtitle: string
  trend?: {
    value: number
    direction: 'up' | 'down' | 'unchanged'
  }
  loading?: boolean
}

function MetricCard({ title, value, subtitle, trend, loading }: MetricCardProps) {
  return (
    <div className="rounded-xl border bg-card px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
        {loading ? '...' : value.toLocaleString()}
      </div>
      {trend ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={[
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
              trend.direction === 'up'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : trend.direction === 'down'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted text-muted-foreground',
            ].join(' ')}
          >
            {trend.direction === 'up' ? <ArrowUpRight className="size-3" /> : null}
            {trend.direction === 'down' ? <ArrowDownRight className="size-3" /> : null}
            {trend.direction === 'unchanged' ? <Minus className="size-3" /> : null}
            {trend.value > 0 ? '+' : ''}
            {trend.value}
          </span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )
}

export function ChangelogKpiCards({
  loading = false,
  totalCount,
  todayCount,
  yesterdayCount,
  uniqueUsers,
  criticalFieldCount,
  criticalFieldLabel,
  dateRangeDays,
}: ChangelogKpiCardsProps) {
  const t = useT()
  const trendValue = todayCount - yesterdayCount
  const trendDirection = trendValue > 0 ? 'up' : trendValue < 0 ? 'down' : 'unchanged'

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        loading={loading}
        title={t('customers.changelog.kpi.totalChanges', 'All changes')}
        value={totalCount}
        subtitle={t('customers.changelog.kpi.period', 'last {{days}} days', { days: dateRangeDays })}
      />
      <MetricCard
        loading={loading}
        title={t('customers.changelog.kpi.today', 'Today')}
        value={todayCount}
        subtitle={t('customers.changelog.kpi.vsYesterday', 'vs yesterday')}
        trend={{ value: trendValue, direction: trendDirection }}
      />
      <MetricCard
        loading={loading}
        title={t('customers.changelog.kpi.users', 'Users')}
        value={uniqueUsers}
        subtitle={t('customers.changelog.kpi.active', 'active')}
      />
      <MetricCard
        loading={loading}
        title={t('customers.changelog.kpi.criticalFields', 'Critical fields')}
        value={criticalFieldCount}
        subtitle={criticalFieldLabel}
      />
    </div>
  )
}

export default ChangelogKpiCards
