"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { DEFAULT_SETTINGS, hydrateIncidentActiveSettings, type IncidentActiveSettings } from './config'
import { readNumber, readObject, readString } from '../shared'

type SeverityBreakdown = {
  severityId: string | null
  severityKey: string | null
  label: string
  count: number
}

type ActivePayload = {
  total: number
  breakdown: SeverityBreakdown[]
}

function parseBreakdownItem(value: unknown): SeverityBreakdown | null {
  const item = readObject(value)
  if (!item) return null
  const count = readNumber(item.count)
  if (count === null) return null
  return {
    severityId: readString(item.severityId),
    severityKey: readString(item.severityKey),
    label: readString(item.label) ?? readString(item.severityKey) ?? readString(item.severityId) ?? 'unknown',
    count,
  }
}

function parseActivePayload(value: unknown): ActivePayload {
  const payload = readObject(value)
  const total = readNumber(payload?.total) ?? 0
  const breakdown = Array.isArray(payload?.breakdown)
    ? payload.breakdown.map(parseBreakdownItem).filter((item): item is SeverityBreakdown => item !== null)
    : []
  return { total, breakdown }
}

async function loadActiveIncidents(): Promise<ActivePayload> {
  const call = await apiCall<{ total?: unknown; breakdown?: unknown[]; error?: string }>(
    '/api/incidents/dashboard-widgets/active',
  )
  if (!call.ok) {
    const message = typeof call.result?.error === 'string'
      ? call.result.error
      : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  return parseActivePayload(call.result ?? null)
}

const IncidentActiveDashboardWidget: React.FC<DashboardWidgetComponentProps<IncidentActiveSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateIncidentActiveSettings(settings), [settings])
  const [payload, setPayload] = React.useState<ActivePayload>({ total: 0, breakdown: [] })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setPayload(await loadActiveIncidents())
    } catch (err) {
      console.error('Failed to load active incidents widget data', err)
      setError(t('incidents.dashboard.active.error', 'Failed to load active incidents.'))
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

  const breakdownLine = payload.breakdown.length > 0
    ? payload.breakdown.map((item) => `${item.count.toLocaleString()} ${item.label}`).join(' · ')
    : t('incidents.dashboard.active.empty', 'No live incidents.')

  return (
    <Link
      href="/backend/incidents"
      className="block rounded-md focus-visible:outline-none focus-visible:shadow-focus"
      aria-label={t('incidents.dashboard.active.openList', 'Open incidents')}
    >
      <KpiCard
        value={payload.total}
        loading={loading}
        error={error}
        footer={<p className="text-xs text-muted-foreground">{breakdownLine}</p>}
      />
    </Link>
  )
}

export default IncidentActiveDashboardWidget
