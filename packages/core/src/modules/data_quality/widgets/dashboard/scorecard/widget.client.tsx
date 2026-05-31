"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateScorecardSettings,
  type DataQualityScorecardSettings,
} from './config'

type SummaryPayload = {
  score: number | null
  openFindingCount: number
  criticalCount: number
  warningCount: number
  lastScanRun: { id: string; status: string; finishedAt: string | null } | null
}

async function loadSummary(): Promise<SummaryPayload> {
  const call = await apiCall<SummaryPayload>('/api/data_quality/summary')
  if (!call.ok) {
    throw new Error(`Request failed with status ${call.status}`)
  }
  return (call.result ?? { score: null, openFindingCount: 0, criticalCount: 0, warningCount: 0, lastScanRun: null }) as SummaryPayload
}

function formatScore(score: number | null): string {
  if (score === null || score === undefined) return '—'
  return `${score.toFixed(1)}%`
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground'
  if (score >= 90) return 'text-status-success-fg'
  if (score >= 70) return 'text-status-warning-fg'
  return 'text-status-error-fg'
}

const DataQualityScorecardWidget: React.FC<DashboardWidgetComponentProps<DataQualityScorecardSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateScorecardSettings(settings), [settings])
  const [summary, setSummary] = React.useState<SummaryPayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const data = await loadSummary()
      setSummary(data)
    } catch (err) {
      console.error('Failed to load data quality summary', err)
      setError(t('data_quality.widgets.scorecard.error', 'Failed to load data quality summary.'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="dq-scorecard-severity" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('data_quality.widgets.scorecard.settings.severityThreshold', 'Min. Severity')}
          </label>
          <Select
            value={hydrated.severityThreshold}
            onValueChange={(value) => {
              if (value === 'info' || value === 'warning' || value === 'error' || value === 'critical') {
                onSettingsChange({ ...hydrated, severityThreshold: value })
              }
            }}
          >
            <SelectTrigger id="dq-scorecard-severity" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : summary ? (
        <div className="space-y-3">
          <div className="text-center">
            <p className={`text-3xl font-bold ${scoreColor(summary.score)}`}>
              {formatScore(summary.score)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('data_quality.widgets.scorecard.qualityScore', 'Quality Score')}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <p className="font-semibold">{summary.openFindingCount}</p>
              <p className="text-xs text-muted-foreground">{t('data_quality.widgets.scorecard.open', 'Open')}</p>
            </div>
            <div>
              <p className="font-semibold">{summary.criticalCount}</p>
              <p className="text-xs text-muted-foreground">{t('data_quality.widgets.scorecard.critical', 'Critical')}</p>
            </div>
            <div>
              <p className="font-semibold">{summary.warningCount}</p>
              <p className="text-xs text-muted-foreground">{t('data_quality.widgets.scorecard.warnings', 'Warnings')}</p>
            </div>
          </div>
          {summary.lastScanRun && (
            <p className="text-xs text-muted-foreground text-center">
              {t('data_quality.widgets.scorecard.lastScan', 'Last scan')}: {summary.lastScanRun.status}
              {summary.lastScanRun.finishedAt && ` · ${new Date(summary.lastScanRun.finishedAt).toLocaleDateString()}`}
            </p>
          )}
          <div className="text-center pt-1">
            <Link href="/backend/data-quality" className="text-xs text-primary hover:underline">
              {t('data_quality.widgets.scorecard.viewAll', 'View Data Quality →')}
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          {t('data_quality.widgets.scorecard.noData', 'No scan data available yet.')}
        </p>
      )}
    </div>
  )
}

export default DataQualityScorecardWidget
