"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DEFAULT_SETTINGS, hydrateIncidentMttaMttrSettings, type IncidentMttaMttrSettings } from './config'
import { readNumber, readObject, readString } from '../shared'

type MttaMttrPayload = {
  mttaSeconds: number | null
  mttrSeconds: number | null
  dateRange: {
    from: string
    to: string
  } | null
}

function parseMttaMttrPayload(value: unknown): MttaMttrPayload {
  const payload = readObject(value)
  const dateRange = readObject(payload?.dateRange)
  return {
    mttaSeconds: readNumber(payload?.mttaSeconds),
    mttrSeconds: readNumber(payload?.mttrSeconds),
    dateRange: dateRange
      ? {
          from: readString(dateRange.from) ?? '',
          to: readString(dateRange.to) ?? '',
        }
      : null,
  }
}

async function loadMttaMttr(): Promise<MttaMttrPayload> {
  const call = await apiCall<{ mttaSeconds?: unknown; mttrSeconds?: unknown; dateRange?: unknown; error?: string }>(
    '/api/incidents/dashboard-widgets/mtta-mttr',
  )
  if (!call.ok) {
    const message = typeof call.result?.error === 'string'
      ? call.result.error
      : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  return parseMttaMttrPayload(call.result ?? null)
}

function formatDuration(seconds: number | null, t: (key: string, fallback?: string) => string): string {
  if (seconds === null) return '—'
  if (!Number.isFinite(seconds)) return '—'
  const roundedMinutes = Math.round(seconds / 60)
  const totalMinutes = seconds > 0 ? Math.max(1, roundedMinutes) : 0
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const hourUnit = t('incidents.dashboard.common.hoursShort', 'h')
  const minuteUnit = t('incidents.dashboard.common.minutesShort', 'm')
  if (hours > 0 && minutes > 0) return `${hours}${hourUnit} ${minutes}${minuteUnit}`
  if (hours > 0) return `${hours}${hourUnit}`
  return `${minutes}${minuteUnit}`
}

const IncidentMttaMttrDashboardWidget: React.FC<DashboardWidgetComponentProps<IncidentMttaMttrSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateIncidentMttaMttrSettings(settings), [settings])
  const [payload, setPayload] = React.useState<MttaMttrPayload>({
    mttaSeconds: null,
    mttrSeconds: null,
    dateRange: null,
  })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setPayload(await loadMttaMttr())
    } catch (err) {
      console.error('Failed to load MTTA/MTTR widget data', err)
      setError(t('incidents.dashboard.mttaMttr.error', 'Failed to load response and resolution metrics.'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [hydrated, refresh, refreshToken])

  if (mode === 'settings') {
    return <p className="text-sm text-muted-foreground">{t('incidents.dashboard.common.noSettings', 'No settings available.')}</p>
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('incidents.dashboard.mttaMttr.mttaLabel', 'MTTA')}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-card-foreground">
            {formatDuration(payload.mttaSeconds, t)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('incidents.dashboard.mttaMttr.mttrLabel', 'MTTR')}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-card-foreground">
            {formatDuration(payload.mttrSeconds, t)}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('incidents.dashboard.mttaMttr.period', 'Created in the last 30 days.')}</p>
    </div>
  )
}

export default IncidentMttaMttrDashboardWidget
