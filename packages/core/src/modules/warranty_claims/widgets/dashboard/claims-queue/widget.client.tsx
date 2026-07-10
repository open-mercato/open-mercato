"use client"

import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { WarrantyClaimsStats } from '../../../backend/components/ClaimsKpiStrip'
import { DEFAULT_SETTINGS, hydrateWarrantyClaimsQueueSettings, type WarrantyClaimsQueueSettings } from './config'

type ClaimsStatsResponse = {
  ok?: boolean
  result?: WarrantyClaimsStats
  error?: string
}

const OPEN_STATUS_ORDER = [
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'awaiting_return',
  'received',
  'inspecting',
] as const

const STATUS_FALLBACK_LABELS: Record<(typeof OPEN_STATUS_ORDER)[number], string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  info_requested: 'Info requested',
  approved: 'Approved',
  awaiting_return: 'Awaiting return',
  received: 'Received',
  inspecting: 'Inspecting',
}

const CLAIMS_LIST_PATH = '/backend/warranty_claims'

function buildOpenClaimsHref(): string {
  return `${CLAIMS_LIST_PATH}?status=${OPEN_STATUS_ORDER.join(',')}`
}

function buildOverdueHref(): string {
  return `${CLAIMS_LIST_PATH}?overdueOnly=true`
}

function buildAtRiskHref(): string {
  return `${CLAIMS_LIST_PATH}?slaAtRiskOnly=true`
}

function buildStatusHref(status: string): string {
  return `${CLAIMS_LIST_PATH}?status=${encodeURIComponent(status)}`
}

async function loadClaimsStats(): Promise<WarrantyClaimsStats> {
  const call = await apiCall<ClaimsStatsResponse>('/api/warranty_claims/stats')
  if (!call.ok) {
    const message = typeof call.result?.error === 'string'
      ? call.result.error
      : `[internal] Request failed with status ${call.status}`
    throw new Error(message)
  }
  const payload = call.result
  if (payload?.ok !== true || !payload.result) {
    throw new Error('[internal] Malformed warranty claims stats response')
  }
  return payload.result
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value)
}

const WarrantyClaimsQueueWidget: React.FC<DashboardWidgetComponentProps<WarrantyClaimsQueueSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateWarrantyClaimsQueueSettings(settings), [settings])
  const [stats, setStats] = React.useState<WarrantyClaimsStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const data = await loadClaimsStats()
      setStats(data)
    } catch {
      setError(t('warranty_claims.widgets.queue.error', 'Failed to load warranty claims'))
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="warranty-claims-queue-show-breakdown"
            checked={hydrated.showStatusBreakdown}
            onCheckedChange={(checked) => {
              onSettingsChange({ ...hydrated, showStatusBreakdown: checked === true })
            }}
          />
          <label htmlFor="warranty-claims-queue-show-breakdown" className="text-sm">
            {t('warranty_claims.widgets.queue.settings.showStatusBreakdown', 'Show status breakdown')}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            'warranty_claims.widgets.queue.settings.help',
            'Toggle the per-status rows shown under the headline counts.',
          )}
        </p>
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (loading && !stats) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    )
  }

  if (!stats) {
    return <p className="text-sm text-muted-foreground">{t('warranty_claims.widgets.queue.empty', 'No open claims')}</p>
  }

  const openClaims = OPEN_STATUS_ORDER.reduce((sum, status) => sum + (stats.openByStatus[status] ?? 0), 0)

  if (openClaims === 0 && stats.overdue === 0) {
    return <p className="text-sm text-muted-foreground">{t('warranty_claims.widgets.queue.empty', 'No open claims')}</p>
  }

  const breakdown = OPEN_STATUS_ORDER
    .map((status) => ({ status, count: stats.openByStatus[status] ?? 0 }))
    .filter((entry) => entry.count > 0)

  const atRisk = typeof stats.slaAtRisk === 'number' ? stats.slaAtRisk : null

  return (
    <div className="space-y-4">
      <div className={cn('grid gap-3', atRisk !== null ? 'grid-cols-3' : 'grid-cols-2')}>
        <Link
          href={buildOpenClaimsHref()}
          className="flex flex-col rounded-md border p-3 transition-colors hover:bg-accent"
        >
          <span className="text-xs text-muted-foreground">
            {t('warranty_claims.kpi.openClaims', 'Open claims')}
          </span>
          <span className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {formatCount(openClaims)}
          </span>
        </Link>
        {atRisk !== null ? (
          <Link
            href={buildAtRiskHref()}
            className="flex flex-col rounded-md border p-3 transition-colors hover:bg-accent"
          >
            <span className="text-xs text-muted-foreground">
              {t('warranty_claims.list.quickFilters.slaAtRisk', 'SLA at risk')}
            </span>
            <span
              className={cn(
                'mt-1 text-2xl font-semibold tabular-nums',
                atRisk > 0 ? 'text-status-warning-text' : 'text-foreground',
              )}
            >
              {formatCount(atRisk)}
            </span>
          </Link>
        ) : null}
        <Link
          href={buildOverdueHref()}
          className="flex flex-col rounded-md border p-3 transition-colors hover:bg-accent"
        >
          <span className="text-xs text-muted-foreground">
            {t('warranty_claims.kpi.overdue', 'Overdue')}
          </span>
          <span
            className={cn(
              'mt-1 text-2xl font-semibold tabular-nums',
              stats.overdue > 0 ? 'text-status-error-text' : 'text-foreground',
            )}
          >
            {formatCount(stats.overdue)}
          </span>
        </Link>
      </div>
      {hydrated.showStatusBreakdown && breakdown.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('warranty_claims.widgets.queue.byStatus', 'Open by status')}
          </p>
          <ul>
            {breakdown.map(({ status, count }) => (
              <li key={status}>
                <Link
                  href={buildStatusHref(status)}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="text-foreground">
                    {t(`warranty_claims.status.${status}`, STATUS_FALLBACK_LABELS[status])}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatCount(count)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export default WarrantyClaimsQueueWidget
