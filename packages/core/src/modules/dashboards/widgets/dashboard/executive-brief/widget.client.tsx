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
import { DEFAULT_SETTINGS, hydrateSettings, type ExecutiveBriefSettings } from './config'
import {
  fetchBusinessIntelligenceMetrics,
  generateExecutiveBrief,
  type ExecutiveBriefResult,
} from '../../../lib/businessIntelligence'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'executive-brief' })

const STATUS_BADGE = {
  healthy: 'bg-status-success-bg text-status-success-text border-status-success-border',
  watch: 'bg-status-warning-bg text-status-warning-text border-status-warning-border',
  critical: 'bg-status-error-bg text-status-error-text border-status-error-border',
}

const ExecutiveBriefWidget: React.FC<DashboardWidgetComponentProps<ExecutiveBriefSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [brief, setBrief] = React.useState<ExecutiveBriefResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchWidgetData = useWidgetData()

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const metrics = await fetchBusinessIntelligenceMetrics(hydrated, fetchWidgetData)
      const briefResult = generateExecutiveBrief(metrics)
      setBrief(briefResult)
    } catch (err) {
      logger.error('Failed to load executive brief data', { err })
      setError(t('dashboards.analytics.widgets.executiveBrief.error', 'Failed to generate executive brief'))
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
          id="executive-brief-date-range"
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

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col justify-between h-full space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t('dashboards.analytics.widgets.executiveBrief.title', 'Executive Brief')}
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
      ) : brief ? (
        <div className="space-y-3">
          {/* Headline Banner */}
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-card-foreground">
              {brief.headline}
            </h4>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${
                STATUS_BADGE[brief.status]
              }`}
            >
              {brief.status}
            </span>
          </div>

          {/* Narrative Paragraph */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            {brief.narrative}
          </p>

          {/* Key Takeaways */}
          {brief.keyTakeaways.length > 0 && (
            <div className="pt-2 border-t space-y-1">
              <p className="text-[11px] font-semibold text-card-foreground uppercase tracking-wider">
                {t('dashboards.analytics.widgets.executiveBrief.keyTakeaways', 'Key Metrics')}
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {brief.keyTakeaways.map((takeaway, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 rounded-full bg-muted-foreground/60 flex-shrink-0" />
                    <span>{takeaway}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

export default ExecutiveBriefWidget
