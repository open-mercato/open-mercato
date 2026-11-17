"use client"

import * as React from 'react'
import Link from 'next/link'
import { LineChart } from '@open-mercato/ui/backend/charts'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../../components/types'
import { evalSuiteOutcomeVariant, formatPassScore } from '../../../../components/evalRunTypes'
import {
  AgentVersionsLabel,
  DeltaPoints,
  compareRunsHref,
  shortDatasetKey,
  type EvalTrend,
} from '../../../../components/evalRegression'

const TREND_LIMIT = 50
const ALL_DATASETS = '__all__'
const UNPINNED_DATASET = '__unpinned__'

export type EvalRegressionSectionProps = {
  agentId: string
  active: boolean
  reloadToken?: number
}

export default function EvalRegressionSection({ agentId, active, reloadToken = 0 }: EvalRegressionSectionProps) {
  const t = useT()
  const locale = useLocale()
  const [trend, setTrend] = React.useState<EvalTrend | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dataset, setDataset] = React.useState<string>(ALL_DATASETS)

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ agentDefinitionId: agentId, limit: String(TREND_LIMIT) })
    void apiCall<EvalTrend>(`/api/agent_orchestrator/eval-runs/trend?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result) {
          setError(t('agent_orchestrator.evalRegression.trend.error'))
          return
        }
        setTrend(call.result)
      })
      .catch(() => {
        if (!cancelled) setError(t('agent_orchestrator.evalRegression.trend.error'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, agentId, reloadToken, t])

  const datasets = React.useMemo(() => {
    const keys = new Set<string>()
    for (const point of trend?.points ?? []) keys.add(point.datasetKey ?? UNPINNED_DATASET)
    return Array.from(keys)
  }, [trend])

  const points = React.useMemo(() => {
    const all = trend?.points ?? []
    if (dataset === ALL_DATASETS) return all
    return all.filter((point) => (point.datasetKey ?? UNPINNED_DATASET) === dataset)
  }, [trend, dataset])

  const chartData = React.useMemo(
    () =>
      points.map((point) => ({
        run: `${formatDateTime(point.createdAt, locale) ?? point.createdAt} · ${
          point.agentVersions.map((version) => version ?? '?').join(', ') || '—'
        }`,
        passScore: point.passScore === null ? null : Math.round(point.passScore * 100),
      })),
    [points, locale],
  )

  const recent = React.useMemo(() => [...points].reverse(), [points])

  if (isLoading && !trend) {
    return <LoadingMessage label={t('agent_orchestrator.evalRegression.title')} />
  }
  if (error) return <ErrorMessage label={error} />
  if (!trend || trend.points.length === 0) {
    return (
      <EmptyState
        title={t('agent_orchestrator.evalRegression.empty.title')}
        description={t('agent_orchestrator.evalRegression.empty.description')}
      />
    )
  }

  const datasetLabel = (key: string) =>
    key === UNPINNED_DATASET ? t('agent_orchestrator.evalRegression.dataset.unpinned') : shortDatasetKey(key) ?? key

  return (
    <div className="space-y-5" data-testid="eval-regression-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalRegression.description')}</p>
        {datasets.length > 1 ? (
          <Select value={dataset} onValueChange={setDataset}>
            <SelectTrigger className="w-64" aria-label={t('agent_orchestrator.evalRegression.dataset.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DATASETS}>{t('agent_orchestrator.evalRegression.dataset.all')}</SelectItem>
              {datasets.map((key) => (
                <SelectItem key={key} value={key}>
                  {datasetLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <LineChart
          title={t('agent_orchestrator.evalRegression.trend.title')}
          data={chartData}
          index="run"
          categories={['passScore']}
          categoryLabels={{ passScore: t('agent_orchestrator.evalRuns.col.passScore') }}
          valueFormatter={(value) => `${value}%`}
          showLegend={false}
          connectNulls={false}
          emptyMessage={t('agent_orchestrator.evalRegression.empty.title')}
        />
        {dataset === ALL_DATASETS && datasets.length > 1 ? (
          <p className="mt-2 text-xs text-status-warning-text">{t('agent_orchestrator.evalRegression.dataset.mixedWarning')}</p>
        ) : null}
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('agent_orchestrator.evalRegression.versions.title')}</h3>
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.version')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.runs')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.latestPass')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.meanPass')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.delta')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.lastSeen')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trend.versions.map((version) => (
                <TableRow key={version.agentVersion ?? 'unknown'}>
                  <TableCell>
                    <AgentVersionsLabel versions={[version.agentVersion]} />
                  </TableCell>
                  <TableCell className="tabular-nums">{version.runCount}</TableCell>
                  <TableCell>
                    <Link
                      href={`/backend/eval-runs/${encodeURIComponent(version.latestSuiteRunId)}`}
                      className="text-sm font-medium tabular-nums text-foreground underline-offset-2 hover:underline"
                    >
                      {formatPassScore(version.latestPassScore) ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatPassScore(version.meanPassScore) ?? '—'}</TableCell>
                  <TableCell>
                    {version.previousVersion !== null && version.sameDataset === false ? (
                      <span className="text-xs text-muted-foreground">
                        {t('agent_orchestrator.evalRegression.versions.otherDataset')}
                      </span>
                    ) : (
                      <DeltaPoints value={version.passScoreDelta} />
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {formatDateTime(version.lastSeenAt, locale) ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{t('agent_orchestrator.evalRegression.runs.title')}</h3>
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agent_orchestrator.evalRuns.col.when')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.versions.col.version')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.dataset.label')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRuns.col.outcome')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRuns.col.passScore')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRegression.runs.col.delta')}</TableHead>
                <TableHead className="text-right">{t('agent_orchestrator.evalRegression.runs.col.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((point) => (
                <TableRow key={point.suiteRunId} data-testid={`eval-regression-run-${point.suiteRunId}`}>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {formatDateTime(point.createdAt, locale) ?? '—'}
                  </TableCell>
                  <TableCell>
                    <AgentVersionsLabel versions={point.agentVersions} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {datasetLabel(point.datasetKey ?? UNPINNED_DATASET)}
                  </TableCell>
                  <TableCell>
                    {point.outcome ? (
                      <StatusBadge variant={evalSuiteOutcomeVariant[point.outcome]}>
                        {t(`agent_orchestrator.evalRuns.outcome.${point.outcome}`)}
                      </StatusBadge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-medium tabular-nums">{formatPassScore(point.passScore) ?? '—'}</TableCell>
                  <TableCell>
                    <DeltaPoints value={point.passScoreDelta} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-3 text-sm">
                      {point.previousSuiteRunId ? (
                        <Link
                          href={compareRunsHref(point.previousSuiteRunId, point.suiteRunId)}
                          className="font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {t('agent_orchestrator.evalRegression.runs.compareWithPrevious')}
                        </Link>
                      ) : null}
                      <Link
                        href={`/backend/eval-runs/${encodeURIComponent(point.suiteRunId)}`}
                        className="text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {t('agent_orchestrator.evalRegression.runs.openRun')}
                      </Link>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}
