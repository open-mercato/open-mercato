"use client"

import * as React from 'react'
import Link from 'next/link'
import { GitBranch, Hourglass, TriangleAlert } from 'lucide-react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  XRAY_API_BASE,
  buildQueryString,
  isAbortError,
  xrayProcessApiPath,
  xrayProcessPagePath,
} from '../../../lib/client/xray/api'
import { xrayRequest } from '../../../lib/client/xray/hooks'
import { cycleTimeFigure } from '../../../lib/client/xray/durations'
import { formatActivityKey, formatCount, formatDurationMs } from '../../../lib/client/xray/format'
import type {
  XrayBottleneckItem,
  XrayBottlenecksResponse,
  XrayDurationsResponse,
  XrayProcessItem,
  XrayProcessesResponse,
} from '../../../lib/client/xray/types'
import { describeDurationFigure } from '../../../components/xray/XrayCycleTimeKpis'
import type { InsightsProcessHealthSettings } from './widget'

export const PROCESS_HEALTH_WINDOW = '30d'
export const PROCESS_HEALTH_TOP = 3

export type ProcessHealthRow = {
  process: XrayProcessItem
  durations: XrayDurationsResponse | null
  bottleneck: XrayBottleneckItem | null
  /** Server-resolved labels of the bottleneck's activities. */
  activityLabels: Record<string, string>
}

export type ProcessHealthData = {
  rows: ProcessHealthRow[]
  incomplete: boolean
}

/** The busiest visible processes (by cases in the window) with their cycle times and longest wait. */
export async function loadProcessHealth(signal?: AbortSignal): Promise<ProcessHealthData> {
  const init = signal ? { signal } : undefined
  const query = buildQueryString({ window: PROCESS_HEALTH_WINDOW })
  const processes = await xrayRequest<XrayProcessesResponse>(`${XRAY_API_BASE}/processes${query}`, init)
  if (!processes.ok) throw new Error(`[internal] Process X-Ray processes request failed with status ${processes.error.httpStatus ?? 'unknown'}`)
  const top = [...processes.body.items].sort((left, right) => right.n - left.n).slice(0, PROCESS_HEALTH_TOP)
  const rows = await Promise.all(top.map(async (process): Promise<ProcessHealthRow> => {
    if (process.n === 0) return { process, durations: null, bottleneck: null, activityLabels: {} }
    const [durations, bottlenecks] = await Promise.all([
      xrayRequest<XrayDurationsResponse>(`${xrayProcessApiPath(process.processKey, 'durations')}${query}`, init),
      xrayRequest<XrayBottlenecksResponse>(`${xrayProcessApiPath(process.processKey, 'bottlenecks')}${query}`, init),
    ])
    const bottleneck = bottlenecks.ok
      ? bottlenecks.body.items.find((item) => item.wait.medianMs !== null) ?? null
      : null
    return { process, durations: durations.ok ? durations.body : null, bottleneck, activityLabels: bottlenecks.ok ? bottlenecks.body.activityLabels ?? {} : {} }
  }))
  return { rows, incomplete: processes.body.incomplete }
}

function cycleTimeText(row: ProcessHealthRow, t: TranslateFn, locale: string): string {
  if (!row.durations) return t('insights.xray.ui.stats.notReported')
  const figure = cycleTimeFigure(row.durations.completed, 'median')
  if (figure.kind === 'value') return formatDurationMs(figure.valueMs, t) ?? '—'
  return describeDurationFigure(figure, t, locale) ?? '—'
}

function ProcessHealthItem({ row }: { row: ProcessHealthRow }) {
  const t = useT()
  const locale = useLocale()
  const { process, bottleneck, activityLabels } = row
  return (
    <li className="space-y-1 rounded-md border border-border p-3" data-testid="xray-process-health-row" data-process-key={process.processKey}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`${xrayProcessPagePath(process.processKey)}?w=${PROCESS_HEALTH_WINDOW}`} className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:shadow-focus">
          <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
          {t(process.labelKey)}
        </Link>
        {process.lowConfidence ? (
          <StatusBadge variant="warning">
            <TriangleAlert className="size-3" aria-hidden="true" />
            {t('insights.xray.ui.meta.lowConfidence')}
          </StatusBadge>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{t('insights.xray.ui.kpi.cases')}</dt>
          <dd className="text-sm font-medium">{formatCount(process.n, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('insights.xray.ui.kpi.openCases')}</dt>
          <dd className="text-sm font-medium">{process.openCases === null ? t('insights.xray.ui.stats.hidden') : formatCount(process.openCases, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('insights.xray.ui.kpi.medianCycleTime')}</dt>
          <dd className="text-sm font-medium">{cycleTimeText(row, t, locale)}</dd>
        </div>
      </dl>
      {bottleneck ? (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Hourglass className="size-3" aria-hidden="true" />
          {t('insights.xray.ui.widget.bottleneck', {
            from: formatActivityKey(bottleneck.from, t, activityLabels),
            to: formatActivityKey(bottleneck.to, t, activityLabels),
            wait: formatDurationMs(bottleneck.wait.medianMs, t) ?? '—',
          })}
        </p>
      ) : null}
    </li>
  )
}

const InsightsProcessHealthWidget: React.FC<DashboardWidgetComponentProps<InsightsProcessHealthSettings>> = ({
  mode,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const [data, setData] = React.useState<ProcessHealthData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (mode === 'settings') return
    const controller = new AbortController()
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    loadProcessHealth(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setData(next)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !isAbortError(err)) setError(t('insights.xray.ui.widget.error'))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
          onRefreshStateChange?.(false)
        }
      })
    return () => {
      controller.abort()
      onRefreshStateChange?.(false)
    }
  }, [mode, onRefreshStateChange, refreshToken, t])

  if (mode === 'settings') {
    return <p className="text-sm text-muted-foreground">{t('insights.xray.ui.widget.noSettings')}</p>
  }
  if (loading && !data) return <LoadingMessage label={t('insights.xray.ui.loading')} />
  if (error) return <ErrorMessage label={error} />
  if (!data || data.rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="subtle"
        icon={<GitBranch className="size-5" aria-hidden="true" />}
        title={t('insights.xray.ui.widget.emptyTitle')}
        description={t('insights.xray.ui.widget.emptyDescription')}
      />
    )
  }
  return (
    <div className="space-y-3" data-testid="xray-process-health">
      <p className="text-xs text-muted-foreground">{t('insights.xray.ui.widget.window')}</p>
      {data.incomplete ? (
        <Alert status="warning" size="sm">
          <AlertDescription>{t('insights.xray.ui.meta.incompleteTitle')}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="space-y-2">
        {data.rows.map((row) => <ProcessHealthItem key={row.process.processKey} row={row} />)}
      </ul>
    </div>
  )
}

export default InsightsProcessHealthWidget
