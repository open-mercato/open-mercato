"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
  getComparisonLabelKey,
} from '@open-mercato/ui/backend/date-range'
import { DEFAULT_SETTINGS, hydrateSettings, type BusinessHealthScoreSettings } from './config'
import {
  fetchBusinessIntelligenceMetrics,
  calculateHealthScore,
  type HealthScoreResult,
} from '../../../lib/businessIntelligence'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'business-health-score' })

const STATUS_CONFIG = {
  healthy: {
    labelKey: 'dashboards.analytics.widgets.businessHealthScore.statusHealthy',
    defaultLabel: 'Healthy',
    badgeClass: 'bg-status-success-bg text-status-success-text border-status-success-border',
    barClass: 'bg-emerald-500',
  },
  watch: {
    labelKey: 'dashboards.analytics.widgets.businessHealthScore.statusWatch',
    defaultLabel: 'Watch',
    badgeClass: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
    barClass: 'bg-amber-500',
  },
  critical: {
    labelKey: 'dashboards.analytics.widgets.businessHealthScore.statusCritical',
    defaultLabel: 'Critical',
    badgeClass: 'bg-status-error-bg text-status-error-text border-status-error-border',
    barClass: 'bg-rose-500',
  },
}

const BusinessHealthScoreWidget: React.FC<DashboardWidgetComponentProps<BusinessHealthScoreSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [result, setResult] = React.useState<HealthScoreResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchWidgetData = useWidgetData()

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const metrics = await fetchBusinessIntelligenceMetrics(hydrated, fetchWidgetData)
      const scoreResult = calculateHealthScore(metrics)
      setResult(scoreResult)
    } catch (err) {
      logger.error('Failed to load business health score data', { err })
      setError(t('dashboards.analytics.widgets.businessHealthScore.error', 'Failed to calculate health score'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, fetchWidgetData, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <DateRangeSelect
          id="health-score-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hydrated.showComparison}
              onChange={(e) => onSettingsChange({ ...hydrated, showComparison: e.target.checked })}
              className="h-4 w-4 rounded border focus-visible:ring-ring"
            />
            {t('dashboards.analytics.settings.showComparison', 'Show comparison')}
          </label>
        </div>
      </div>
    )
  }

  const comparisonInfo = getComparisonLabelKey(hydrated.dateRange)
  const comparisonLabel = hydrated.showComparison ? t(comparisonInfo.key, comparisonInfo.fallback) : null

  const statusInfo = result ? STATUS_CONFIG[result.status] : STATUS_CONFIG.watch
  const statusLabel = t(statusInfo.labelKey, statusInfo.defaultLabel)

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col justify-between h-full space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t('dashboards.analytics.widgets.businessHealthScore.title', 'Business Health Score')}
        </p>
        <InlineDateRangeSelect
          value={hydrated.dateRange}
          onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
        />
      </div>

      {/* Body */}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-6">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : result ? (
        <div className="space-y-3">
          {/* Main Metric Value & Status Badge */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl sm:text-4xl font-bold tracking-tight text-card-foreground">
                {result.score}
              </span>
              <span className="text-sm font-medium text-muted-foreground">/100</span>
            </div>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold border ${statusInfo.badgeClass}`}
            >
              {statusLabel}
            </span>
          </div>

          {/* Visual Progress Meter */}
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${statusInfo.barClass}`}
              style={{ width: `${result.score}%` }}
            />
          </div>

          {/* Explanation Text */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            {result.summary}
          </p>
        </div>
      ) : (
        <p className="text-2xl font-semibold tracking-tight text-card-foreground">--</p>
      )}

      {/* Footer */}
      {comparisonLabel && (
        <div className="pt-1 border-t text-[11px] text-muted-foreground">
          {comparisonLabel}
        </div>
      )}
    </div>
  )
}

export default BusinessHealthScoreWidget
