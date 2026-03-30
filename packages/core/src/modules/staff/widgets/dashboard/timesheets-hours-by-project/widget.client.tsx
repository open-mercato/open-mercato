"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import { DEFAULT_SETTINGS, hydrateSettings, type HoursByProjectSettings } from './config'

type WidgetDataItem = { groupKey: string; groupLabel?: string; value: number | null }
type WidgetDataResponse = {
  value: number | null
  data: WidgetDataItem[]
  metadata: { fetchedAt: string; recordCount: number }
}

function minutesToHours(minutes: number): string {
  const hours = minutes / 60
  return hours % 1 === 0 ? String(hours) : hours.toFixed(1)
}

async function fetchData(settings: HoursByProjectSettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'staff:staff_time_entries',
    metric: { field: 'durationMinutes', aggregate: 'sum' },
    groupBy: { field: 'timeProjectId', limit: 20, resolveLabels: true },
    dateRange: { field: 'date', preset: settings.dateRange },
  }

  const res = await apiCall<WidgetDataResponse>('/api/dashboards/widgets/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = (res.result as Record<string, unknown>)?.error
    throw new Error(typeof err === 'string' ? err : 'Failed to fetch data')
  }

  return res.result as WidgetDataResponse
}

const HoursByProjectWidget: React.FC<DashboardWidgetComponentProps<HoursByProjectSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<WidgetDataItem[]>([])
  const [totalMinutes, setTotalMinutes] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchData(hydrated)
      const sorted = [...result.data].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      setData(sorted)
      setTotalMinutes(sorted.reduce((sum, item) => sum + (item.value ?? 0), 0))
    } catch (err) {
      console.error('staff.timesheets.hoursByProject', err)
      setError(t('staff.timesheets.widgets.hoursByProject.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <DateRangeSelect
          id="hours-by-project-date-range"
          label={t('staff.timesheets.widgets.hoursByProject.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">{t('staff.timesheets.widgets.hoursByProject.loading', 'Loading...')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.value ?? 0)) : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <InlineDateRangeSelect
          value={hydrated.dateRange}
          onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
        />
      </div>

      {data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('staff.timesheets.widgets.hoursByProject.empty', 'No hours tracked in this period.')}
        </p>
      ) : (
        <div className="space-y-2.5">
          {data.map((item) => {
            const barWidth = maxValue > 0 ? ((item.value ?? 0) / maxValue) * 100 : 0
            return (
              <div key={item.groupKey} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate font-medium">{item.groupLabel || item.groupKey}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{minutesToHours(item.value ?? 0)} h</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            )
          })}

          <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
            <span>{t('staff.timesheets.widgets.hoursByProject.total', 'Total')}</span>
            <span className="tabular-nums">{minutesToHours(totalMinutes)} h</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default HoursByProjectWidget
