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
import { DEFAULT_SETTINGS, hydrateSettings, type NeedsAttentionSettings } from './config'
import {
  fetchBusinessIntelligenceMetrics,
  identifyAttentionItems,
  type AttentionItem,
  type AttentionSeverity,
} from '../../../lib/businessIntelligence'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'needs-attention' })

const SEVERITY_STYLES: Record<
  AttentionSeverity,
  {
    containerClass: string
    badgeClass: string
    badgeText: string
  }
> = {
  critical: {
    containerClass: 'border-l-4 border-l-rose-500 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40',
    badgeClass: 'bg-status-error-bg text-status-error-text',
    badgeText: 'Critical',
  },
  warning: {
    containerClass: 'border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40',
    badgeClass: 'bg-status-warning-bg text-status-warning-text',
    badgeText: 'Warning',
  },
  positive: {
    containerClass: 'border-l-4 border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40',
    badgeClass: 'bg-status-success-bg text-status-success-text',
    badgeText: 'Growth',
  },
}

const NeedsAttentionWidget: React.FC<DashboardWidgetComponentProps<NeedsAttentionSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [items, setItems] = React.useState<AttentionItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchWidgetData = useWidgetData()

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const metrics = await fetchBusinessIntelligenceMetrics(hydrated, fetchWidgetData)
      const attentionItems = identifyAttentionItems(metrics)
      setItems(attentionItems)
    } catch (err) {
      logger.error('Failed to load needs-attention data', { err })
      setError(t('dashboards.analytics.widgets.needsAttention.error', 'Failed to load attention items'))
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
          id="needs-attention-date-range"
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
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            {t('dashboards.analytics.widgets.needsAttention.title', 'Needs Attention')}
          </p>
          {items.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {items.length}
            </span>
          )}
        </div>
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
      ) : items.length === 0 ? (
        <div className="rounded-md border border-emerald-200/60 bg-emerald-50/40 p-4 text-center dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            {t('dashboards.analytics.widgets.needsAttention.allGood', 'All Metrics Within Normal Range')}
          </p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            {t(
              'dashboards.analytics.widgets.needsAttention.allGoodDesc',
              'No significant drops or divergence detected for this period.'
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
          {items.map((item) => {
            const style = SEVERITY_STYLES[item.severity]
            return (
              <div
                key={item.id}
                className={`rounded-md p-3 text-xs space-y-1 transition-colors ${style.containerClass}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-card-foreground">{item.title}</span>
                  <span
                    className={`inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider ${style.badgeClass}`}
                  >
                    {style.badgeText}
                  </span>
                </div>
                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            )
          })}
        </div>
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

export default NeedsAttentionWidget
