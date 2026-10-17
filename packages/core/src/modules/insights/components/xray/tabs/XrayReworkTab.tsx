"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { xrayAnalyticsUrl } from '../../../lib/client/xray/api'
import { formatActivityKey, formatCount, formatPercent } from '../../../lib/client/xray/format'
import { useXrayResource } from '../../../lib/client/xray/hooks'
import type { XrayReworkResponse, XrayReworkStage } from '../../../lib/client/xray/types'
import { XrayResultMeta } from '../XrayResultMeta'
import { XrayTabResource, type XrayTabProps } from './shared'

export function XrayReworkTab({ processKey, window, filters, onClearActorFilters }: XrayTabProps) {
  const t = useT()
  const locale = useLocale()
  const resource = useXrayResource<XrayReworkResponse>(xrayAnalyticsUrl(processKey, 'rework', window, filters))
  const formatNumber = React.useCallback((value: number) => formatCount(value, locale), [locale])

  const activityLabels = resource.data?.activityLabels
  const columns = React.useMemo<ColumnDef<XrayReworkStage>[]>(() => [
    {
      accessorKey: 'activityKey',
      header: t('insights.xray.ui.rework.columns.activity'),
      cell: ({ row }) => <span title={row.original.activityKey}>{formatActivityKey(row.original.activityKey, t, activityLabels)}</span>,
      meta: { truncate: true, maxWidth: '320px' },
    },
    { accessorKey: 'rework', header: t('insights.xray.ui.rework.columns.rework'), cell: ({ row }) => formatCount(row.original.rework, locale) },
    { accessorKey: 'reworkRaw', header: t('insights.xray.ui.rework.columns.reworkRaw'), cell: ({ row }) => formatCount(row.original.reworkRaw, locale) },
    { accessorKey: 'corrections', header: t('insights.xray.ui.rework.columns.corrections'), cell: ({ row }) => formatCount(row.original.corrections, locale) },
    { accessorKey: 'cases', header: t('insights.xray.ui.rework.columns.cases'), cell: ({ row }) => formatCount(row.original.cases, locale) },
  ], [activityLabels, locale, t])

  return (
    <XrayTabResource resource={resource} onClearActorFilters={onClearActorFilters}>
      {(data) => (
        <>
          <XrayResultMeta meta={data} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title={t('insights.xray.ui.rework.rate')}
              value={data.reworkRate}
              formatValue={(value) => formatPercent(value, locale, 1)}
              footer={(
                <p className="text-xs text-muted-foreground">
                  {data.reworkRate === null
                    ? t('insights.xray.ui.stats.hiddenOrEmpty')
                    : t('insights.xray.ui.rework.rateLowerBound', { value: formatPercent(data.reworkRateLowerBound ?? 0, locale, 1) })}
                </p>
              )}
            />
            <KpiCard title={t('insights.xray.ui.rework.casesWithRework')} value={data.casesWithRework} formatValue={formatNumber} />
            <KpiCard title={t('insights.xray.ui.rework.corrections')} value={data.corrections} formatValue={formatNumber} />
            <KpiCard title={t('insights.xray.ui.rework.debounced')} value={data.debounced} formatValue={formatNumber} />
          </div>
          <p className="text-xs text-muted-foreground">{t('insights.xray.ui.rework.help')}</p>
          <DataTable<XrayReworkStage>
            embedded
            columns={columns}
            data={data.byStage}
            emptyState={(
              <EmptyState
                variant="subtle"
                title={t('insights.xray.ui.rework.emptyTitle')}
                description={data.suppressed.cells > 0 ? t('insights.xray.ui.rework.emptySuppressed') : t('insights.xray.ui.rework.emptyDescription')}
              />
            )}
          />
        </>
      )}
    </XrayTabResource>
  )
}
