"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

type SettingsPayload = {
  proposalExpiryDays?: unknown
  billingChannelConfigured?: unknown
  billingChannelId?: unknown
  today?: unknown
  error?: unknown
}

export type LeaseSettings = { proposalExpiryDays: number | null; billingChannelConfigured: boolean; today: string | null }

export type LeaseSettingsState = { settings: LeaseSettings | null; loadError: string | null; loading: boolean; retry: () => void }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function browserToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function leaseToday(settings: Pick<LeaseSettings, 'today'> | null | undefined, now: Date = new Date()): string {
  return settings?.today ?? browserToday(now)
}

export function readLeaseSettings(payload: SettingsPayload | null | undefined): LeaseSettings {
  const days = payload?.proposalExpiryDays
  const configured = typeof payload?.billingChannelConfigured === 'boolean'
    ? payload.billingChannelConfigured
    : typeof payload?.billingChannelId === 'string' && payload.billingChannelId.length > 0
  const today = typeof payload?.today === 'string' && ISO_DAY.test(payload.today) ? payload.today : null
  return { proposalExpiryDays: typeof days === 'number' && Number.isInteger(days) && days > 0 ? days : null, billingChannelConfigured: configured, today }
}

export function useLeaseSettings({ enabled = true }: { enabled?: boolean } = {}): LeaseSettingsState {
  const t = useT()
  const [settings, setSettings] = React.useState<LeaseSettings | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(enabled)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    const failed = (status: number | null) => {
      if (cancelled) return
      setLoadError(status === 403
        ? t('property_management.leases.settings.forbidden', 'You do not have permission to read the lease settings.')
        : t('property_management.leases.settings.loadError', 'Could not load the lease settings.'))
      setLoading(false)
    }
    setLoading(true)
    setLoadError(null)
    apiCall<SettingsPayload>('/api/property_management/settings', undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          failed(call.status)
          return
        }
        setSettings(readLeaseSettings(call.result))
        setLoading(false)
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_settings_load_failed' })
        failed(null)
      })
    return () => {
      cancelled = true
    }
  }, [attempt, enabled, t])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { settings, loadError, loading, retry }
}
