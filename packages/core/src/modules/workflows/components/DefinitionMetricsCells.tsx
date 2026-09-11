"use client"

/**
 * Per-definition KPI cells for the definitions list (spec §8.5).
 *
 * The list already has one row per definition, so the KPIs belong in columns
 * rather than on a separate dashboard: an operator asking "which of my
 * processes is unhealthy" is scanning this list, and sending them to a second
 * page to answer it is the split §8.5 exists to avoid.
 *
 * A cell renders nothing but the value, its unit and a tone. Colour is never
 * the only carrier — the number IS the label, and each toned cell also names
 * its state to a screen reader.
 */

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { formatDurationMs } from '../lib/run-duration'
import {
  METRIC_TONE_CLASS,
  formatRate,
  rateTone,
  type MetricTone,
} from '../lib/metrics/metrics-display'
import type { WorkflowRollupWindowKey } from '../lib/metrics/definition-metrics'

export type DefinitionMetricsPayload = {
  runsStarted: number
  runsTerminal: number
  runsCompleted: number
  runsFailed: number
  runsCancelled: number
  successRate: number | null
  durationSampleCount: number
  avgDurationMs: number | null
  p50DurationMs: number | null
  p95DurationMs: number | null
  tasksWithDeadline: number
  tasksMetDeadline: number
  taskSlaHitRate: number | null
}

export type DefinitionMetricsItem = {
  workflowId: string
  window: WorkflowRollupWindowKey
  windowStart: string
  windowEnd: string
  computedAt: string
  source: 'rollup' | 'live'
  metrics: DefinitionMetricsPayload
}

type MetricsResponse = { data: DefinitionMetricsItem[] }

/** Matches the read route's own cap, so a page never sends a request it refuses. */
const METRICS_BATCH_MAX = 50

/**
 * Fetch KPIs for the workflow ids currently on screen, in ONE request.
 *
 * Keyed on the sorted id list so paging refetches and re-rendering does not.
 * Failures are swallowed into `undefined`: a KPI column that cannot load must
 * degrade to a dash, never take the definitions list down with it.
 */
export function useDefinitionMetrics(
  workflowIds: string[],
  window: WorkflowRollupWindowKey,
): { byWorkflowId: Map<string, DefinitionMetricsItem>; isLoading: boolean; failed: boolean } {
  const ids = React.useMemo(
    () =>
      Array.from(new Set(workflowIds))
        .sort((left, right) => left.localeCompare(right))
        .slice(0, METRICS_BATCH_MAX),
    [workflowIds],
  )

  const query = useQuery({
    queryKey: ['workflow-definition-metrics', window, ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<MetricsResponse> => {
      const params = new URLSearchParams({ window, workflowIds: ids.join(',') })
      const result = await apiCall<MetricsResponse>(`/api/workflows/metrics/definitions?${params.toString()}`)
      if (!result.ok || !result.result || !Array.isArray(result.result.data)) {
        throw new Error('[internal] workflow definition metrics request failed')
      }
      return result.result
    },
  })

  const byWorkflowId = React.useMemo(() => {
    const map = new Map<string, DefinitionMetricsItem>()
    for (const item of query.data?.data ?? []) map.set(item.workflowId, item)
    return map
  }, [query.data])

  return { byWorkflowId, isLoading: query.isLoading && ids.length > 0, failed: query.isError }
}

function MetricPlaceholder({ loading }: { loading: boolean }) {
  const t = useT()
  if (loading) return <Spinner className="h-3 w-3" aria-label={t('common.loading')} />
  return (
    <span className="text-sm text-muted-foreground" aria-label={t('workflows.metrics.noData')}>
      —
    </span>
  )
}

function TonedValue({
  value,
  tone,
  toneLabel,
  title,
}: {
  value: string
  tone: MetricTone
  toneLabel: string
  title?: string
}) {
  return (
    <span className={`text-sm font-medium ${METRIC_TONE_CLASS[tone]}`} title={title}>
      {value}
      <span className="sr-only"> — {toneLabel}</span>
    </span>
  )
}

export function RunsCell({ item, loading }: { item?: DefinitionMetricsItem; loading: boolean }) {
  const t = useT()
  if (!item) return <MetricPlaceholder loading={loading} />
  const { runsStarted, runsTerminal } = item.metrics
  return (
    <span
      className="text-sm"
      title={t('workflows.metrics.runsHint', { started: runsStarted, terminal: runsTerminal })}
    >
      {runsStarted}
    </span>
  )
}

export function SuccessRateCell({ item, loading }: { item?: DefinitionMetricsItem; loading: boolean }) {
  const t = useT()
  if (!item) return <MetricPlaceholder loading={loading} />
  const { successRate, runsTerminal, runsFailed } = item.metrics
  const label = formatRate(successRate)
  if (label === null) {
    return (
      <span className="text-sm text-muted-foreground" title={t('workflows.metrics.noTerminalRuns')}>
        —
      </span>
    )
  }
  const tone = rateTone(successRate)
  return (
    <TonedValue
      value={label}
      tone={tone}
      toneLabel={t(`workflows.metrics.tone.${tone}`)}
      title={t('workflows.metrics.successHint', { terminal: runsTerminal, failed: runsFailed })}
    />
  )
}

export function P95DurationCell({ item, loading }: { item?: DefinitionMetricsItem; loading: boolean }) {
  const t = useT()
  if (!item) return <MetricPlaceholder loading={loading} />
  const { p95DurationMs, durationSampleCount } = item.metrics
  if (p95DurationMs === null) {
    return (
      <span className="text-sm text-muted-foreground" title={t('workflows.metrics.noDurationSample')}>
        —
      </span>
    )
  }
  return (
    <span
      className="text-sm tabular-nums"
      title={t('workflows.metrics.p95Hint', { samples: durationSampleCount })}
    >
      {formatDurationMs(p95DurationMs)}
    </span>
  )
}

export function TaskSlaCell({ item, loading }: { item?: DefinitionMetricsItem; loading: boolean }) {
  const t = useT()
  if (!item) return <MetricPlaceholder loading={loading} />
  const { taskSlaHitRate, tasksWithDeadline, tasksMetDeadline } = item.metrics
  const label = formatRate(taskSlaHitRate)
  if (label === null) {
    // "No task in this window carried a deadline" is not a 0% hit rate, and a
    // red 0% would send an operator looking for an SLA that was never authored.
    return (
      <span className="text-sm text-muted-foreground" title={t('workflows.metrics.noTaskDeadlines')}>
        —
      </span>
    )
  }
  const tone = rateTone(taskSlaHitRate)
  return (
    <TonedValue
      value={label}
      tone={tone}
      toneLabel={t(`workflows.metrics.tone.${tone}`)}
      title={t('workflows.metrics.slaHint', { met: tasksMetDeadline, total: tasksWithDeadline })}
    />
  )
}
