"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart } from '@open-mercato/ui/backend/charts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { xrayAnalyticsUrl } from '../../../lib/client/xray/api'
import { formatCount, formatDurationMs, formatPercent, shortId } from '../../../lib/client/xray/format'
import { useXrayLabels, type XrayLabelKind } from '../../../lib/client/xray/labels'
import { useXrayResource } from '../../../lib/client/xray/hooks'
import type { XrayBreakdownGroup, XrayBreakdownItem, XrayBreakdownResponse } from '../../../lib/client/xray/types'
import { XrayResultMeta } from '../XrayResultMeta'
import { XrayTabResource, type XrayTabProps } from './shared'

export const XRAY_BREAKDOWN_GROUPS: XrayBreakdownGroup[] = ['org', 'role', 'team', 'user']

const NONE_GROUP = 'none'
const CHART_ITEMS = 10

type BreakdownRow = XrayBreakdownItem & { label: string; organizationLabel: string }

function labelKindOf(groupBy: XrayBreakdownGroup): XrayLabelKind | null {
  if (groupBy === 'role') return 'role'
  if (groupBy === 'team') return 'team'
  return null
}

function share(part: number, item: XrayBreakdownItem): number | null {
  const total = item.causes.human + item.causes.automated + item.causes.legacy + item.causes.other
  return total > 0 ? part / total : null
}

export function XrayBreakdownTab({ processKey, window, filters, onClearActorFilters, canViewIndividuals }: XrayTabProps & { canViewIndividuals: boolean }) {
  const t = useT()
  const locale = useLocale()
  const [groupBy, setGroupBy] = React.useState<XrayBreakdownGroup>('org')
  const resource = useXrayResource<XrayBreakdownResponse>(xrayAnalyticsUrl(processKey, 'breakdown', window, filters, { groupBy }))
  const organizationIds = React.useMemo(
    () => Array.from(new Set((resource.data?.items ?? []).map((item) => item.organizationId))),
    [resource.data],
  )
  const resultGroupBy: XrayBreakdownGroup = resource.data?.groupBy ?? groupBy
  const perPerson = resource.data?.perPerson === true || resultGroupBy === 'user'
  const groupLabels = useXrayLabels(labelKindOf(resultGroupBy))
  const organizationLabels = useXrayLabels('org', organizationIds)

  const rows = React.useMemo<BreakdownRow[]>(() => {
    const items = resource.data?.items ?? []
    return items.map((item, index) => {
      const organizationLabel = organizationLabels.get(item.organizationId.toLowerCase()) ?? shortId(item.organizationId)
      let label: string
      if (item.group === NONE_GROUP) label = t('insights.xray.ui.breakdown.noGroup')
      else if (perPerson) label = t('insights.xray.ui.breakdown.person', { index: index + 1 })
      else if (resultGroupBy === 'org') label = organizationLabel
      else label = groupLabels.get(item.group.toLowerCase()) ?? shortId(item.group)
      return { ...item, label, organizationLabel }
    })
  }, [groupLabels, organizationLabels, perPerson, resource.data, resultGroupBy, t])

  const columns = React.useMemo<ColumnDef<BreakdownRow>[]>(() => {
    const list: ColumnDef<BreakdownRow>[] = [
      {
        id: 'group',
        header: t(`insights.xray.ui.breakdown.groupColumn.${resultGroupBy}`),
        cell: ({ row }) => (perPerson ? <span>{row.original.label}</span> : <span title={row.original.group}>{row.original.label}</span>),
        meta: { truncate: true, maxWidth: '280px' },
      },
    ]
    if (resultGroupBy !== 'org' && organizationIds.length > 1) {
      list.push({ id: 'organization', header: t('insights.xray.ui.breakdown.columns.organization'), cell: ({ row }) => row.original.organizationLabel })
    }
    list.push(
      { accessorKey: 'cases', header: t('insights.xray.ui.breakdown.columns.cases'), cell: ({ row }) => formatCount(row.original.cases, locale) },
      { accessorKey: 'collapsed', header: t('insights.xray.ui.breakdown.columns.events'), cell: ({ row }) => formatCount(row.original.collapsed, locale) },
      { accessorKey: 'actors', header: t('insights.xray.ui.breakdown.columns.actors'), cell: ({ row }) => formatCount(row.original.actors, locale) },
      {
        id: 'human',
        header: t('insights.xray.ui.breakdown.columns.human'),
        cell: ({ row }) => {
          const value = share(row.original.causes.human, row.original)
          return value === null ? '—' : formatPercent(value, locale)
        },
      },
      {
        id: 'automated',
        header: t('insights.xray.ui.breakdown.columns.automated'),
        cell: ({ row }) => {
          const value = share(row.original.causes.automated, row.original)
          return value === null ? '—' : formatPercent(value, locale)
        },
      },
      {
        id: 'stepWait',
        header: t('insights.xray.ui.breakdown.columns.stepWait'),
        cell: ({ row }) => formatDurationMs(row.original.stepWait.medianMs, t)
          ?? <span className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.tooFew', { n: formatCount(row.original.stepWait.n, locale), minimum: 5 })}</span>,
      },
    )
    return list
  }, [locale, organizationIds.length, perPerson, resultGroupBy, t])

  const chartData = rows.slice(0, CHART_ITEMS).map((row) => ({ group: row.label, cases: row.cases }))

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <SegmentedControl
          value={groupBy}
          onValueChange={(next) => {
            if ((XRAY_BREAKDOWN_GROUPS as string[]).includes(next)) setGroupBy(next as XrayBreakdownGroup)
          }}
          size="sm"
          aria-label={t('insights.xray.ui.breakdown.groupLabel')}
        >
          {XRAY_BREAKDOWN_GROUPS.map((group) => (
            <SegmentedControlItem key={group} value={group} disabled={group === 'user' && !canViewIndividuals}>
              {t(`insights.xray.ui.breakdown.group.${group}`)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {!canViewIndividuals ? (
          <p className="text-xs text-muted-foreground" data-testid="xray-breakdown-user-unavailable">{t('insights.xray.ui.breakdown.userUnavailable')}</p>
        ) : null}
      </div>
      <XrayTabResource resource={resource} onClearActorFilters={onClearActorFilters}>
        {(data) => (
          <>
            <XrayResultMeta meta={data} />
            {data.perPerson ? (
              <Alert status="information" size="default" data-testid="xray-breakdown-per-person">
                <AlertTitle>{t('insights.xray.ui.breakdown.perPersonTitle')}</AlertTitle>
                <AlertDescription>{t('insights.xray.ui.breakdown.perPersonDescription')}</AlertDescription>
              </Alert>
            ) : null}
            {data.overlapping ? <p className="text-xs text-muted-foreground">{t('insights.xray.ui.breakdown.overlapping')}</p> : null}
            {chartData.length > 1 ? (
              <BarChart
                title={t('insights.xray.ui.breakdown.chartTitle')}
                data={chartData}
                index="group"
                categories={['cases']}
                categoryLabels={{ cases: t('insights.xray.ui.breakdown.columns.cases') }}
                showLegend={false}
                valueFormatter={(value) => formatCount(value, locale)}
              />
            ) : null}
            <DataTable<BreakdownRow>
              embedded
              columns={columns}
              data={rows}
              emptyState={(
                <EmptyState
                  variant="subtle"
                  title={t('insights.xray.ui.breakdown.emptyTitle')}
                  description={data.suppressed.cells > 0 ? t('insights.xray.ui.breakdown.emptySuppressed') : t('insights.xray.ui.breakdown.emptyDescription')}
                />
              )}
            />
          </>
        )}
      </XrayTabResource>
    </div>
  )
}
