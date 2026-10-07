"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { allowedWindows, hydrateMarketingOverviewSettings, type MarketingOverviewSettings } from './config'

const logger = createLogger('marketing_automation')

type Overview = {
  windowDays: number
  campaigns: { enabled: number; total: number }
  runs: number
  sends: { sent: number; suppressed: number; failed: number }
  engagement: { opened: number; clicked: number }
  revenue: Array<{ currencyCode: string | null; orders: number; revenue: number }>
}

function isOverview(value: unknown): value is Overview {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<Overview>
  return typeof data.runs === 'number' && typeof data.sends === 'object' && typeof data.engagement === 'object'
}

/** A rate over nobody is not a rate of nothing — the same rule the funnel follows. */
function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

export default function MarketingOverviewWidget({
  mode,
  settings,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}: DashboardWidgetComponentProps<MarketingOverviewSettings>) {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateMarketingOverviewSettings(settings), [settings])
  const [data, setData] = React.useState<Overview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await apiCall<unknown>(
        `/api/marketing_automation/dashboard/overview?days=${hydrated.windowDays}`,
      )
      if (!result.ok || !isOverview(result.result)) {
        // A failed request is not an empty week: the widget says so rather than showing five zeroes.
        setError(t('marketing_automation.widgets.overview.error', 'Marketing figures could not be loaded.'))
        setData(null)
        return
      }
      setData(result.result)
    } catch (err) {
      logger.error('[internal] marketing overview widget failed to load', { err })
      setError(t('marketing_automation.widgets.overview.error', 'Marketing figures could not be loaded.'))
      setData(null)
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-2 text-sm">
        <label htmlFor="marketing-overview-window" className="text-xs font-semibold uppercase text-muted-foreground">
          {t('marketing_automation.widgets.overview.window', 'Period')}
        </label>
        <Select
          value={String(hydrated.windowDays)}
          onValueChange={(value) => onSettingsChange?.({ ...hydrated, windowDays: Number(value) })}
        >
          <SelectTrigger id="marketing-overview-window" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedWindows().map((days) => (
              <SelectItem key={days} value={String(days)}>
                {t('marketing_automation.widgets.overview.lastDays', 'Last {count} days').replace('{count}', String(days))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (loading && !data) {
    return <div className="flex h-24 items-center justify-center"><Spinner /></div>
  }

  if (error) {
    return <div className="text-sm text-status-error-text">{error}</div>
  }

  if (!data) return null

  /**
   * Nothing has happened yet — say so, and point at the one screen that explains why.
   *
   * The widget already refuses to print five zeroes for a FAILED request, on the stated grounds that zeroes read
   * as "nothing is working". An unconfigured installation produced exactly those zeroes, on the module's
   * most-seen surface, with a link to Campaigns — the screen that cannot tell the operator what is missing
   * either. This is the dashboard, so it is where somebody first wonders.
   */
  const nothingYet = data.campaigns.total === 0 && data.runs === 0 && data.sends.sent === 0
  if (nothingYet) {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-muted-foreground">
          {t(
            'marketing_automation.widgets.overview.nothingYet',
            'No campaigns yet. The checklist shows what this installation still needs before anything can send.',
          )}
        </div>
        <Link className="underline" href="/backend/marketing/setup">
          {t('marketing_automation.widgets.overview.openSetup', 'Getting started')}
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-overline text-muted-foreground">
            {t('marketing_automation.widgets.overview.sent', 'Messages sent')}
          </div>
          <div className="text-xl font-semibold tabular-nums text-foreground">{data.sends.sent}</div>
          {/* Suppressed and failed are different facts and both matter: one is a gate doing its job, the
              other is the transport refusing. Shown only when non-zero, so a quiet week stays quiet. */}
          {data.sends.suppressed > 0 || data.sends.failed > 0 ? (
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.widgets.overview.heldBack', '{suppressed} held back · {failed} failed')
                .replace('{suppressed}', String(data.sends.suppressed))
                .replace('{failed}', String(data.sends.failed))}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-overline text-muted-foreground">
            {t('marketing_automation.widgets.overview.engagement', 'Engagement')}
          </div>
          {/* People, not events — the module counts unique runs everywhere for the same reason. */}
          <div className="text-xl font-semibold tabular-nums text-foreground">{rate(data.engagement.clicked, data.sends.sent)}</div>
          <div className="text-xs text-muted-foreground">
            {t('marketing_automation.widgets.overview.opensClicks', '{opened} opened · {clicked} clicked')
              .replace('{opened}', String(data.engagement.opened))
              .replace('{clicked}', String(data.engagement.clicked))}
          </div>
        </div>
      </div>

      {data.revenue.length > 0 ? (
        <div>
          <div className="text-overline text-muted-foreground">
            {t('marketing_automation.widgets.overview.revenue', 'Attributed revenue')}
          </div>
          {/* Never summed across currencies: one number mixing PLN and EUR means nothing. */}
          {data.revenue.map((row) => (
            <div key={row.currencyCode ?? 'none'} className="flex justify-between tabular-nums">
              <span className="text-foreground">{row.revenue}{row.currencyCode ? ` ${row.currencyCode}` : ''}</span>
              <span className="text-xs text-muted-foreground">
                {t('marketing_automation.widgets.overview.orders', '{count} orders').replace('{count}', String(row.orders))}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span>
          {t('marketing_automation.widgets.overview.campaigns', '{enabled} of {total} campaigns live · {runs} runs started')
            .replace('{enabled}', String(data.campaigns.enabled))
            .replace('{total}', String(data.campaigns.total))
            .replace('{runs}', String(data.runs))}
        </span>
        {/* The widget is a summary; the screen behind it is where somebody acts. */}
        <Link className="underline" href="/backend/marketing/campaigns">
          {t('marketing_automation.widgets.overview.open', 'Campaigns')}
        </Link>
      </div>
    </div>
  )
}
