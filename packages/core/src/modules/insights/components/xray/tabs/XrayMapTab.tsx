"use client"

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { xrayAnalyticsUrl, xrayProcessPagePath } from '../../../lib/client/xray/api'
import { formatActivityKey, formatCount } from '../../../lib/client/xray/format'
import { XRAY_GRAPH_MODES, buildProcessGraph, type XrayGraphEdge, type XrayGraphMode, type XrayGraphModel } from '../../../lib/client/xray/graph'
import { useXrayResource } from '../../../lib/client/xray/hooks'
import type { XrayMapResponse } from '../../../lib/client/xray/types'
import { serializeWindow } from '../../../lib/client/xray/window'
import { XrayCauseBadge, XrayCauseLegend } from '../XrayCauseBadge'
import { XrayProcessMap, type XrayMapSelection } from '../XrayProcessMap'
import { XrayResultMeta } from '../XrayResultMeta'
import { XrayTabResource, type XrayTabProps } from './shared'

type EndpointLabels = {
  labelOf: (activityKey: string) => string
  isHidden: (activityKey: string) => boolean
}

/**
 * Labels of map endpoints: the server label of a visible step (client fallback without one) and
 * a placeholder for a step hidden for privacy, which never shows its name.
 */
function useEndpointLabels(data: XrayMapResponse | null, graph: XrayGraphModel | null): EndpointLabels {
  const t = useT()
  return React.useMemo(() => {
    const hidden = new Set((graph?.nodes ?? []).filter((node) => node.kind === 'hidden').map((node) => node.activityKey))
    const labels = data?.activityLabels
    return {
      isHidden: (activityKey: string) => hidden.has(activityKey),
      labelOf: (activityKey: string) => (hidden.has(activityKey) ? t('insights.xray.ui.map.hiddenStep') : formatActivityKey(activityKey, t, labels)),
    }
  }, [data?.activityLabels, graph, t])
}

function SelectionDetails({
  selection,
  data,
  processKey,
  windowParam,
  labelOf,
}: {
  selection: XrayMapSelection
  data: XrayMapResponse
  processKey: string
  windowParam: string
  labelOf: EndpointLabels['labelOf']
}) {
  const t = useT()
  const locale = useLocale()
  if (!selection) {
    return <p className="text-xs text-muted-foreground">{t('insights.xray.ui.map.selectHint')}</p>
  }
  if (selection.kind === 'edge') {
    const edge = data.edges.find((candidate) => candidate.from === selection.from && candidate.to === selection.to)
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm" data-testid="xray-map-selection">
        <p className="font-medium">{t('insights.xray.ui.map.transition', { from: labelOf(selection.from), to: labelOf(selection.to) })}</p>
        {edge ? (
          <p className="text-muted-foreground">
            {t('insights.xray.ui.map.edgeCounts', {
              raw: formatCount(edge.raw, locale),
              collapsed: formatCount(edge.collapsed, locale),
              cases: formatCount(edge.cases, locale),
            })}
          </p>
        ) : null}
      </div>
    )
  }
  const node = data.nodes.find((candidate) => candidate.activityKey === selection.activityKey)
  const casesHref = `${xrayProcessPagePath(processKey, 'cases')}?activity=${encodeURIComponent(selection.activityKey)}&w=${encodeURIComponent(windowParam)}`
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm" data-testid="xray-map-selection">
      <div className="space-y-1">
        <p className="font-medium" title={node ? selection.activityKey : undefined}>{node ? labelOf(selection.activityKey) : t('insights.xray.ui.map.hiddenStep')}</p>
        {node ? (
          <p className="text-muted-foreground">
            {t('insights.xray.ui.map.nodeDetails', {
              raw: formatCount(node.raw, locale),
              collapsed: formatCount(node.collapsed, locale),
              cases: formatCount(node.cases, locale),
              human: formatCount(node.causes.human, locale),
              automated: formatCount(node.causes.automated, locale),
              legacy: formatCount(node.causes.legacy, locale),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('insights.xray.ui.map.hiddenNodeDetails')}</p>
        )}
      </div>
      {node ? (
        <Button asChild variant="outline" size="sm">
          <Link href={casesHref}>{t('insights.xray.ui.map.viewCases')}</Link>
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The process map tab: the directly-follows graph (raw or collapsed counting), the transitions
 * as an accessible table, and the selected step or transition with a drill-down to its cases.
 */
export function XrayMapTab({ processKey, window, filters, onClearActorFilters }: XrayTabProps) {
  const t = useT()
  const locale = useLocale()
  const [mode, setMode] = React.useState<XrayGraphMode>('collapsed')
  const [selection, setSelection] = React.useState<XrayMapSelection>(null)
  const resource = useXrayResource<XrayMapResponse>(xrayAnalyticsUrl(processKey, 'map', window, filters))
  const model = React.useMemo(() => (resource.data ? buildProcessGraph(resource.data, mode) : null), [mode, resource.data])
  const endpoints = useEndpointLabels(resource.data, model)

  React.useEffect(() => setSelection(null), [resource.data])

  const columns = React.useMemo<ColumnDef<XrayGraphEdge>[]>(() => [
    {
      accessorKey: 'from',
      header: t('insights.xray.ui.map.columns.from'),
      cell: ({ row }) => <span title={endpoints.isHidden(row.original.from) ? undefined : row.original.from}>{endpoints.labelOf(row.original.from)}</span>,
      meta: { truncate: true, maxWidth: '240px' },
    },
    {
      accessorKey: 'to',
      header: t('insights.xray.ui.map.columns.to'),
      cell: ({ row }) => <span title={endpoints.isHidden(row.original.to) ? undefined : row.original.to}>{endpoints.labelOf(row.original.to)}</span>,
      meta: { truncate: true, maxWidth: '240px' },
    },
    {
      accessorKey: 'count',
      header: t('insights.xray.ui.map.columns.count'),
      cell: ({ row }) => formatCount(row.original.count, locale),
    },
    {
      accessorKey: 'cases',
      header: t('insights.xray.ui.map.columns.cases'),
      cell: ({ row }) => formatCount(row.original.cases, locale),
    },
    {
      accessorKey: 'causeClass',
      header: t('insights.xray.ui.map.columns.cause'),
      cell: ({ row }) => <XrayCauseBadge causeClass={row.original.causeClass} />,
    },
  ], [endpoints, locale, t])

  return (
    <XrayTabResource resource={resource} onClearActorFilters={onClearActorFilters}>
      {(data) => {
        const graph = model ?? buildProcessGraph(data, mode)
        const transitions = [...graph.edges].sort((left, right) => right.count - left.count)
        return (
          <>
            <XrayResultMeta meta={data} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                value={mode}
                onValueChange={(next) => {
                  if ((XRAY_GRAPH_MODES as readonly string[]).includes(next)) setMode(next as XrayGraphMode)
                }}
                size="sm"
                aria-label={t('insights.xray.ui.map.modeLabel')}
              >
                <SegmentedControlItem value="collapsed">{t('insights.xray.ui.map.mode.collapsed')}</SegmentedControlItem>
                <SegmentedControlItem value="raw">{t('insights.xray.ui.map.mode.raw')}</SegmentedControlItem>
              </SegmentedControl>
              <XrayCauseLegend />
            </div>
            <p className="text-xs text-muted-foreground" data-testid="xray-map-events">
              {t('insights.xray.ui.map.events', {
                raw: formatCount(data.events.raw, locale),
                collapsed: formatCount(data.events.collapsed, locale),
                debounced: formatCount(data.events.debounced, locale),
                corrected: formatCount(data.events.corrected, locale),
              })}
            </p>
            {graph.nodes.length === 0 ? (
              <TabEmptyState
                title={t('insights.xray.ui.map.emptyTitle')}
                description={data.suppressed.cells > 0 ? t('insights.xray.ui.map.emptySuppressed') : t('insights.xray.ui.map.emptyDescription')}
              />
            ) : (
              <>
                {graph.hiddenNodes > 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="xray-map-hidden-note">
                    {t('insights.xray.ui.map.hiddenNote', { count: formatCount(graph.hiddenNodes, locale) })}
                  </p>
                ) : null}
                <XrayProcessMap model={graph} labels={data.activityLabels} onSelectionChange={setSelection} />
                <SelectionDetails selection={selection} data={data} processKey={processKey} windowParam={serializeWindow(window)} labelOf={endpoints.labelOf} />
                {data.omitted.nodes > 0 || data.omitted.edges > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('insights.xray.ui.map.omitted', { nodes: formatCount(data.omitted.nodes, locale), edges: formatCount(data.omitted.edges, locale) })}
                  </p>
                ) : null}
                <section className="space-y-2" aria-label={t('insights.xray.ui.map.transitionsTitle')}>
                  <h3 className="text-sm font-semibold">{t('insights.xray.ui.map.transitionsTitle')}</h3>
                  <DataTable<XrayGraphEdge>
                    embedded
                    columns={columns}
                    data={transitions}
                    emptyState={<EmptyState variant="subtle" size="sm" title={t('insights.xray.ui.map.noTransitions')} />}
                  />
                </section>
              </>
            )}
          </>
        )
      }}
    </XrayTabResource>
  )
}
