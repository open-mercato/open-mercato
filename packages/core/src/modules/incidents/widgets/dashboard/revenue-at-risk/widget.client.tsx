"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import {
  DEFAULT_SETTINGS,
  hydrateIncidentRevenueAtRiskSettings,
  type IncidentRevenueAtRiskSettings,
} from './config'
import { formatMajorAmount, formatMinorAmount, minorToMajor, readObject, readString } from '../shared'

type CurrencyTotal = {
  currency: string | null
  amountMinor: string
}

type RevenuePayload = {
  dominant: CurrencyTotal
  currencies: CurrencyTotal[]
}

function parseCurrencyTotal(value: unknown): CurrencyTotal | null {
  const item = readObject(value)
  if (!item) return null
  return {
    currency: readString(item.currency),
    amountMinor: readString(item.amountMinor) ?? '0',
  }
}

function parseRevenuePayload(value: unknown): RevenuePayload {
  const payload = readObject(value)
  const dominant = parseCurrencyTotal(payload?.dominant) ?? { currency: null, amountMinor: '0' }
  const currencies = Array.isArray(payload?.currencies)
    ? payload.currencies.map(parseCurrencyTotal).filter((item): item is CurrencyTotal => item !== null)
    : []
  return { dominant, currencies }
}

async function loadRevenueAtRisk(): Promise<RevenuePayload> {
  const call = await apiCall<{ dominant?: unknown; currencies?: unknown[]; error?: string }>(
    '/api/incidents/dashboard-widgets/revenue-at-risk',
  )
  if (!call.ok) {
    const message = typeof call.result?.error === 'string'
      ? call.result.error
      : `Request failed with status ${call.status}`
    throw new Error(message)
  }
  return parseRevenuePayload(call.result ?? null)
}

const IncidentRevenueAtRiskDashboardWidget: React.FC<DashboardWidgetComponentProps<IncidentRevenueAtRiskSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateIncidentRevenueAtRiskSettings(settings), [settings])
  const [payload, setPayload] = React.useState<RevenuePayload>({
    dominant: { currency: null, amountMinor: '0' },
    currencies: [],
  })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [locale, setLocale] = React.useState<string | undefined>(undefined)

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setLocale(navigator.language)
    }
  }, [])

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setPayload(await loadRevenueAtRisk())
    } catch (err) {
      console.error('Failed to load revenue at risk widget data', err)
      setError(t('incidents.dashboard.revenueAtRisk.error', 'Failed to load revenue at risk.'))
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

  const additionalCurrencies = payload.currencies.slice(1)
  const additionalLine = additionalCurrencies.length > 0
    ? additionalCurrencies
        .map((item) => formatMinorAmount(item.amountMinor, item.currency, locale))
        .join(' · ')
    : null
  const footer = additionalLine
    ? <p className="text-xs text-muted-foreground">{additionalLine}</p>
    : payload.dominant.amountMinor === '0'
      ? <p className="text-xs text-muted-foreground">{t('incidents.dashboard.revenueAtRisk.empty', 'No revenue currently at risk.')}</p>
      : null

  return (
    <KpiCard
      value={minorToMajor(payload.dominant.amountMinor)}
      loading={loading}
      error={error}
      formatValue={(value) => formatMajorAmount(value, payload.dominant.currency, locale)}
      footer={footer}
    />
  )
}

export default IncidentRevenueAtRiskDashboardWidget
