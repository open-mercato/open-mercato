"use client"

import * as React from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { TrendingUp, Building2, ClipboardList, Clock } from 'lucide-react'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'

type HealthScore = {
  score: number
  label: 'excellent' | 'good' | 'at_risk' | 'critical'
  components: {
    activityRecency: number
    dealPipelineHealth: number
    orderFrequency: number
    interactionCount: number
  }
}

type AlertItem = {
  type: string
  severity: 'warning' | 'error'
  tab?: string
}

type MetricsData = {
  monthlyRevenue: number
  branchCount: number
  activeOffers: number
  lastContactDate: string | null
  healthScore: HealthScore
  averageOrderValue: number
  alerts?: AlertItem[]
}

// Health status colors — intentionally not theme-dependent
function healthColor(label: HealthScore['label']): string {
  switch (label) {
    case 'excellent':
      return '#16a34a'
    case 'good':
      return '#2563eb'
    case 'at_risk':
      return '#d97706'
    case 'critical':
      return '#dc2626'
  }
}

function healthLabelClass(label: HealthScore['label']): string {
  switch (label) {
    case 'excellent':
      return 'text-green-600'
    case 'good':
      return 'text-blue-600'
    case 'at_risk':
      return 'text-amber-600'
    case 'critical':
      return 'text-red-600'
  }
}

function HealthRing({ score, label, ringLabel }: { score: number; label: HealthScore['label']; ringLabel: string }) {
  const color = healthColor(label)
  const radius = 22
  const circumference = 2 * Math.PI * radius
  const dashLength = (score / 100) * circumference

  return (
    <div className="flex items-center gap-3">
      <svg width={54} height={54} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={27}
          cy={27}
          r={radius}
          fill="none"
          className="stroke-border"
          strokeWidth={4}
        />
        <circle
          cx={27}
          cy={27}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={`${dashLength} ${circumference}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div>
        <div
          className={`text-2xl font-black tabular-nums leading-none tracking-tight ${healthLabelClass(label)}`}
        >
          {score}
        </div>
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {ringLabel}
        </div>
      </div>
    </div>
  )
}

function HealthScoreTooltipContent({
  components,
  t,
}: {
  components: HealthScore['components']
  t: TranslateFn
}) {
  const dimensions = [
    {
      label: t('customers.companies.detail.health.tooltip.activityRecency', 'Activity Recency'),
      weight: '30%',
      value: components.activityRecency,
    },
    {
      label: t('customers.companies.detail.health.tooltip.dealPipelineHealth', 'Deal Pipeline Health'),
      weight: '25%',
      value: components.dealPipelineHealth,
    },
    {
      label: t('customers.companies.detail.health.tooltip.orderFrequency', 'Order Frequency'),
      weight: '25%',
      value: components.orderFrequency,
    },
    {
      label: t('customers.companies.detail.health.tooltip.interactionCount', 'Interaction Count'),
      weight: '20%',
      value: components.interactionCount,
    },
  ]

  const thresholds = [
    { label: t('customers.companies.detail.health.excellent', 'Excellent'), range: '≥ 80', colorClass: 'text-green-400' },
    { label: t('customers.companies.detail.health.good', 'Good'), range: '60–79', colorClass: 'text-blue-400' },
    { label: t('customers.companies.detail.health.atRisk', 'At risk'), range: '40–59', colorClass: 'text-amber-400' },
    { label: t('customers.companies.detail.health.critical', 'Critical'), range: '< 40', colorClass: 'text-red-400' },
  ]

  return (
    <div className="space-y-2.5 py-1 text-left" style={{ minWidth: 220 }}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
        {t('customers.companies.detail.health.tooltip.title', 'Score Breakdown')}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-400">
            <th className="pb-1 text-left font-medium">
              {t('customers.companies.detail.health.tooltip.dimension', 'Dimension')}
            </th>
            <th className="pb-1 text-right font-medium">
              {t('customers.companies.detail.health.tooltip.weight', 'Weight')}
            </th>
            <th className="pb-1 text-right font-medium">
              {t('customers.companies.detail.health.tooltip.score', 'Score')}
            </th>
          </tr>
        </thead>
        <tbody>
          {dimensions.map((dim) => (
            <tr key={dim.label}>
              <td className="py-0.5 text-slate-200">{dim.label}</td>
              <td className="py-0.5 text-right tabular-nums text-slate-300">{dim.weight}</td>
              <td className="py-0.5 text-right tabular-nums text-white font-medium">
                {Math.round(dim.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-700 pt-2">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
          {t('customers.companies.detail.health.tooltip.thresholds', 'Thresholds')}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {thresholds.map((th) => (
            <span key={th.range}>
              <span className={th.colorClass}>{th.range}</span>
              <span className="text-slate-400"> {th.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SkeletonStrip() {
  return (
    <div className="grid animate-pulse grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-x">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center px-5 py-4">
          <div className="h-3 w-10 rounded bg-muted" />
          <div className="mt-2 h-7 w-16 rounded bg-muted" />
          <div className="mt-1 h-3 w-12 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

export function CustomerDashboard({
  companyId,
  injectionContext,
  onAlertsLoaded,
}: {
  companyId: string
  injectionContext?: Record<string, unknown>
  onAlertsLoaded?: (alerts: AlertItem[]) => void
}) {
  const t = useT()
  const [metrics, setMetrics] = React.useState<MetricsData | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const onAlertsLoadedRef = React.useRef(onAlertsLoaded)
  onAlertsLoadedRef.current = onAlertsLoaded

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const data = await readApiResultOrThrow<MetricsData>(
          `/api/customers/companies/${encodeURIComponent(companyId)}/metrics`,
          undefined,
          {
            errorMessage: t(
              'customers.companies.detail.metrics.loadError',
              'Failed to load metrics.',
            ),
          },
        )
        if (!cancelled) {
          setMetrics(data)
          if (data.alerts) onAlertsLoadedRef.current?.(data.alerts)
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : t(
                  'customers.companies.detail.metrics.loadError',
                  'Failed to load metrics.',
                ),
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [companyId, t])

  if (isLoading) {
    return <SkeletonStrip />
  }

  if (loadError) {
    return (
      <div className="px-5 py-3">
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}
        </div>
      </div>
    )
  }

  if (!metrics) return null

  const formatCurrency = (value: number) => {
    if (value === 0) return '—'
    return new Intl.NumberFormat(undefined, {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const formatRelativeDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      if (diffDays === 0) return t('customers.companies.detail.metrics.today', 'Today')
      if (diffDays === 1)
        return t('customers.companies.detail.metrics.yesterday', 'Yesterday')
      return t(
        'customers.companies.detail.metrics.daysAgo',
        '{{count}} days ago',
        { count: diffDays },
      )
    } catch {
      return '—'
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString()
    } catch {
      return ''
    }
  }

  const healthLabel = metrics.healthScore.label
  const healthLabels: Record<HealthScore['label'], string> = {
    excellent: t('customers.companies.detail.health.excellent', 'Excellent'),
    good: t('customers.companies.detail.health.good', 'Good'),
    at_risk: t('customers.companies.detail.health.atRisk', 'At risk'),
    critical: t('customers.companies.detail.health.critical', 'Critical'),
  }

  const kpis = [
    {
      icon: <TrendingUp className="size-4 text-green-600" />,
      value: formatCurrency(metrics.monthlyRevenue),
      label: t(
        'customers.companies.detail.metrics.monthlyRevenue',
        'Monthly revenue',
      ),
      sub: t(
        'customers.companies.detail.metrics.avgThreeMonths',
        'avg. 3 months',
      ),
      color: 'text-green-600',
    },
    {
      icon: <Building2 className="size-4 text-muted-foreground" />,
      value: String(metrics.branchCount),
      label: t('customers.companies.detail.metrics.branches', 'Branches'),
      sub: null,
      color: 'text-foreground',
    },
    {
      icon: <ClipboardList className="size-4 text-amber-600" />,
      value: String(metrics.activeOffers),
      label: t(
        'customers.companies.detail.metrics.activeOffers',
        'Active offers',
      ),
      sub: null,
      color: 'text-amber-600',
    },
    {
      icon: <Clock className="size-4 text-muted-foreground" />,
      value: formatRelativeDate(metrics.lastContactDate),
      label: t(
        'customers.companies.detail.metrics.lastContact',
        'Last contact',
      ),
      sub: formatDate(metrics.lastContactDate),
      color: 'text-foreground',
    },
  ]

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-x">
        {kpis.map((kpi, i) => (
          <div key={i} className="flex flex-col items-center px-5 py-4">
            {kpi.icon}
            <span
              className={`mt-1 text-2xl font-black tabular-nums leading-none tracking-tight ${kpi.color}`}
            >
              {kpi.value}
            </span>
            <span className="mt-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {kpi.label}
            </span>
            {kpi.sub && (
              <span className="mt-0.5 text-[10px] text-muted-foreground/60">
                {kpi.sub}
              </span>
            )}
          </div>
        ))}
        {/* Health score with ring */}
        <div className="flex items-center justify-center px-5 py-4">
          <SimpleTooltip
            content={
              <HealthScoreTooltipContent
                components={metrics.healthScore.components}
                t={t}
              />
            }
            side="bottom"
            delayDuration={200}
          >
            <div className="cursor-help">
              <HealthRing
                score={metrics.healthScore.score}
                label={healthLabel}
                ringLabel={t('customers.companies.detail.metrics.healthScore', 'Health Score')}
              />
            </div>
          </SimpleTooltip>
        </div>
      </div>
      <InjectionSpot
        spotId="customers.company.detail:dashboard"
        context={injectionContext ?? {}}
        data={metrics}
      />
    </div>
  )
}
