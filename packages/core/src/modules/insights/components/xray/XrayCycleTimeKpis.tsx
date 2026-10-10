"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { cycleTimeFigure, type XrayDurationFigure } from '../../lib/client/xray/durations'
import { formatCount, formatDurationMs } from '../../lib/client/xray/format'
import type { XrayDurationsResponse, XrayProcessItem } from '../../lib/client/xray/types'

export function describeDurationFigure(figure: XrayDurationFigure, t: TranslateFn, locale?: string | null): string | null {
  if (figure.kind === 'hidden') return t('insights.xray.ui.stats.hidden')
  if (figure.kind === 'empty') return t('insights.xray.ui.stats.noCompleted')
  if (figure.kind === 'too_few') return t('insights.xray.ui.stats.tooFew', { n: formatCount(figure.n, locale), minimum: figure.minimum })
  return figure.lowConfidence
    ? t('insights.xray.ui.stats.basedOnLow', { n: formatCount(figure.n, locale) })
    : t('insights.xray.ui.stats.basedOn', { n: formatCount(figure.n, locale) })
}

export type XrayCycleTimeKpisProps = {
  summary: XrayProcessItem | null
  durations: XrayDurationsResponse | null
  loading: boolean
  error: string | null
}

/**
 * Headline figures of a process: cases with activity in the window (`n`, always shown), cases
 * open at the window end (withheld below k), and the median / p90 cycle time of completed cases
 * (only with n ≥ 5 / n ≥ 20; open cases are right-censored and never part of them).
 */
export function XrayCycleTimeKpis({ summary, durations, loading, error }: XrayCycleTimeKpisProps) {
  const t = useT()
  const locale = useLocale()
  const median = durations ? cycleTimeFigure(durations.completed, 'median') : null
  const p90 = durations ? cycleTimeFigure(durations.completed, 'p90') : null
  const formatNumber = (value: number) => formatCount(value, locale)
  const formatDuration = (value: number) => formatDurationMs(value, t) ?? '—'
  const footer = (text: string | null) => (text ? <p className="text-xs text-muted-foreground">{text}</p> : undefined)
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="xray-kpis">
      <KpiCard
        title={t('insights.xray.ui.kpi.cases')}
        value={summary ? summary.n : null}
        loading={loading && !summary}
        formatValue={formatNumber}
        footer={summary?.lowConfidence ? footer(t('insights.xray.ui.meta.lowConfidence')) : undefined}
      />
      <KpiCard
        title={t('insights.xray.ui.kpi.openCases')}
        value={summary ? summary.openCases : null}
        loading={loading && !summary}
        formatValue={formatNumber}
        footer={summary && summary.openCases === null ? footer(t('insights.xray.ui.stats.hidden')) : footer(t('insights.xray.ui.kpi.openCasesHelp'))}
      />
      <KpiCard
        title={t('insights.xray.ui.kpi.medianCycleTime')}
        value={median?.kind === 'value' ? median.valueMs : null}
        loading={loading && !durations}
        error={error}
        formatValue={formatDuration}
        footer={median ? footer(describeDurationFigure(median, t, locale)) : undefined}
      />
      <KpiCard
        title={t('insights.xray.ui.kpi.p90CycleTime')}
        value={p90?.kind === 'value' ? p90.valueMs : null}
        loading={loading && !durations}
        error={error}
        formatValue={formatDuration}
        footer={p90 ? footer(describeDurationFigure(p90, t, locale)) : undefined}
      />
    </div>
  )
}
