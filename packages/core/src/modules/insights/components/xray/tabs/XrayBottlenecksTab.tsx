"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart } from '@open-mercato/ui/backend/charts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { xrayAnalyticsUrl } from '../../../lib/client/xray/api'
import { formatActivityKey, formatCount, formatDurationMs } from '../../../lib/client/xray/format'
import { useXrayResource } from '../../../lib/client/xray/hooks'
import type { XrayBottleneckItem, XrayBottlenecksResponse } from '../../../lib/client/xray/types'
import { XrayResultMeta } from '../XrayResultMeta'
import { XrayTabResource, type XrayTabProps } from './shared'

const CHART_ITEMS = 8
const HOUR_MS = 60 * 60 * 1000

export function XrayBottlenecksTab({ processKey, window, filters, onClearActorFilters }: XrayTabProps) {
  const t = useT()
  const locale = useLocale()
  const resource = useXrayResource<XrayBottlenecksResponse>(xrayAnalyticsUrl(processKey, 'bottlenecks', window, filters))

  const tooFew = React.useCallback((n: number, minimum: number) => (
    <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.tooFew', { n: formatCount(n, locale), minimum })}</span>
  ), [locale, t])

  const columns = React.useMemo<ColumnDef<XrayBottleneckItem>[]>(() => [
    {
      id: 'transition',
      header: t('insights.xray.ui.bottlenecks.columns.transition'),
      cell: ({ row }) => (
        <span title={`${row.original.from} → ${row.original.to}`}>
          {t('insights.xray.ui.map.transition', { from: formatActivityKey(row.original.from, t), to: formatActivityKey(row.original.to, t) })}
        </span>
      ),
      meta: { truncate: true, maxWidth: '420px' },
    },
    {
      id: 'median',
      header: t('insights.xray.ui.bottlenecks.columns.median'),
      cell: ({ row }) => formatDurationMs(row.original.wait.medianMs, t) ?? tooFew(row.original.wait.n, 5),
    },
    {
      id: 'p90',
      header: t('insights.xray.ui.bottlenecks.columns.p90'),
      cell: ({ row }) => formatDurationMs(row.original.wait.p90Ms, t) ?? tooFew(row.original.wait.n, 20),
    },
    {
      accessorKey: 'transitions',
      header: t('insights.xray.ui.bottlenecks.columns.transitions'),
      cell: ({ row }) => formatCount(row.original.transitions, locale),
    },
    {
      accessorKey: 'cases',
      header: t('insights.xray.ui.bottlenecks.columns.cases'),
      cell: ({ row }) => formatCount(row.original.cases, locale),
    },
    {
      id: 'total',
      header: t('insights.xray.ui.bottlenecks.columns.total'),
      cell: ({ row }) => formatDurationMs(row.original.totalWaitMs, t) ?? <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.notReported')}</span>,
    },
    {
      id: 'confidence',
      header: t('insights.xray.ui.bottlenecks.columns.confidence'),
      cell: ({ row }) => (row.original.wait.lowConfidence
        ? <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.lowConfidenceShort')}</span>
        : <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.sufficient')}</span>),
    },
  ], [locale, t, tooFew])

  return (
    <XrayTabResource resource={resource} onClearActorFilters={onClearActorFilters}>
      {(data) => {
        const chartData = data.items
          .filter((item) => item.wait.medianMs !== null)
          .slice(0, CHART_ITEMS)
          .map((item) => ({
            transition: `${formatActivityKey(item.from, t)} → ${formatActivityKey(item.to, t)}`,
            medianHours: Math.round(((item.wait.medianMs ?? 0) / HOUR_MS) * 10) / 10,
          }))
        return (
          <>
            <XrayResultMeta meta={data} />
            <p className="text-xs text-muted-foreground">
              {t('insights.xray.ui.bottlenecks.summary', {
                measured: formatCount(data.transitions.measured, locale),
                collapsed: formatCount(data.transitions.collapsed, locale),
                excluded: formatCount(data.transitions.excludedSyncRun, locale),
              })}
              {' '}
              {data.includeSyncRun ? t('insights.xray.ui.bottlenecks.syncIncluded') : t('insights.xray.ui.bottlenecks.syncExcluded')}
            </p>
            {chartData.length > 0 ? (
              <BarChart
                title={t('insights.xray.ui.bottlenecks.chartTitle')}
                data={chartData}
                index="transition"
                categories={['medianHours']}
                categoryLabels={{ medianHours: t('insights.xray.ui.bottlenecks.medianHours') }}
                layout="horizontal"
                showLegend={false}
                valueFormatter={(value) => t('insights.xray.ui.duration.hoursDecimal', { hours: value })}
                emptyMessage={t('insights.xray.ui.bottlenecks.emptyTitle')}
              />
            ) : null}
            <DataTable<XrayBottleneckItem>
              embedded
              columns={columns}
              data={data.items}
              emptyState={(
                <EmptyState
                  variant="subtle"
                  title={t('insights.xray.ui.bottlenecks.emptyTitle')}
                  description={data.suppressed.cells > 0 ? t('insights.xray.ui.bottlenecks.emptySuppressed') : t('insights.xray.ui.bottlenecks.emptyDescription')}
                />
              )}
            />
            {data.omitted > 0 ? (
              <p className="text-xs text-muted-foreground">{t('insights.xray.ui.bottlenecks.omitted', { count: formatCount(data.omitted, locale) })}</p>
            ) : null}
          </>
        )
      }}
    </XrayTabResource>
  )
}
