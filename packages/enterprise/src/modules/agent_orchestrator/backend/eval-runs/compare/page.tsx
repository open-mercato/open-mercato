"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatDateTime } from '../../../components/types'
import { agentLabelFor, useAgentLabelMap } from '../../../components/useAgentLabels'
import { evalSuiteOutcomeVariant, formatPassScore } from '../../../components/evalRunTypes'
import {
  AgentVersionsLabel,
  DeltaPoints,
  caseChangeVariant,
  caseStatusVariant,
  shortDatasetKey,
  type CaseRunStatusSummary,
  type SuiteRunComparison,
} from '../../../components/evalRegression'

type CaseFilter = 'changed' | 'all'
type RunSummary = SuiteRunComparison['base']

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const code = (value as Record<string, unknown>).code
  return typeof code === 'string' ? code : null
}

function Stat({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3" data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-lg font-bold tabular-nums text-foreground">{children}</div>
    </div>
  )
}

function RunCard({ title, run }: { title: string; run: RunSummary }) {
  const t = useT()
  const locale = useLocale()
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <Link
          href={`/backend/eval-runs/${encodeURIComponent(run.id)}`}
          className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t('agent_orchestrator.evalRegression.runs.openRun')}
        </Link>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{formatPassScore(run.passScore) ?? '—'}</p>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted-foreground">{t('agent_orchestrator.evalRegression.versions.col.version')}</dt>
          <dd>
            <AgentVersionsLabel versions={run.agentVersions} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted-foreground">{t('agent_orchestrator.evalRegression.dataset.label')}</dt>
          <dd className="font-mono text-xs text-foreground">
            {shortDatasetKey(run.manifestHash ?? run.evalSetVersion) ?? t('agent_orchestrator.evalRegression.dataset.unpinned')}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted-foreground">{t('agent_orchestrator.evalRuns.col.outcome')}</dt>
          <dd>
            {run.outcome ? (
              <StatusBadge variant={evalSuiteOutcomeVariant[run.outcome]}>
                {t(`agent_orchestrator.evalRuns.outcome.${run.outcome}`)}
              </StatusBadge>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted-foreground">{t('agent_orchestrator.evalRuns.col.when')}</dt>
          <dd className="tabular-nums text-foreground">{formatDateTime(run.finishedAt ?? run.createdAt, locale) ?? '—'}</dd>
        </div>
      </dl>
    </section>
  )
}

function CaseStatus({ status }: { status: CaseRunStatusSummary }) {
  const t = useT()
  return (
    <StatusBadge variant={caseStatusVariant[status]} dot={status !== 'absent'}>
      {t(`agent_orchestrator.evalRegression.caseStatus.${status}`)}
    </StatusBadge>
  )
}

function verdictLabel(t: ReturnType<typeof useT>, value: boolean | null): string {
  if (value === true) return t('agent_orchestrator.evalRegression.verdict.passed')
  if (value === false) return t('agent_orchestrator.evalRegression.verdict.failed')
  return t('agent_orchestrator.evalRegression.verdict.skipped')
}

export default function EvalRunComparePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const agentLabels = useAgentLabelMap()
  const baseId = searchParams?.get('base') ?? ''
  const headId = searchParams?.get('head') ?? ''

  const [comparison, setComparison] = React.useState<SuiteRunComparison | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [filter, setFilter] = React.useState<CaseFilter>('changed')

  React.useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    if (!baseId || !headId) {
      setError(t('agent_orchestrator.evalRegression.compare.errors.missing'))
      setIsLoading(false)
      return
    }
    const params = new URLSearchParams({ base: baseId, head: headId })
    void apiCall<SuiteRunComparison>(`/api/agent_orchestrator/eval-runs/compare?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) {
          setComparison(call.result)
          return
        }
        const code = readErrorCode(call.result)
        if (code === 'run_not_finished') setError(t('agent_orchestrator.evalRegression.compare.errors.notFinished'))
        else if (code === 'agent_mismatch') setError(t('agent_orchestrator.evalRegression.compare.errors.agentMismatch'))
        else if (call.status === 404) setError(t('agent_orchestrator.evalRegression.compare.errors.notFound'))
        else setError(t('agent_orchestrator.evalRegression.compare.errors.generic'))
      })
      .catch(() => {
        if (!cancelled) setError(t('agent_orchestrator.evalRegression.compare.errors.generic'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [baseId, headId, t])

  const visibleCases = React.useMemo(() => {
    const cases = comparison?.cases ?? []
    return filter === 'all' ? cases : cases.filter((entry) => entry.change !== 'unchanged')
  }, [comparison, filter])

  const agentId = comparison?.head.agentDefinitionId ?? null

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(
                agentId
                  ? `/backend/agents/${encodeURIComponent(agentId)}?tab=evaluation&section=regressions`
                  : '/backend/agents',
              )
            }
          >
            {t('agent_orchestrator.evalRegression.compare.back')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.evalRegression.compare.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : !comparison ? (
          <ErrorMessage label={t('agent_orchestrator.evalRegression.compare.errors.generic')} />
        ) : (
          <div className="space-y-6" data-testid="eval-compare-page">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t('agent_orchestrator.evalRegression.compare.title')}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {agentLabelFor(agentLabels, comparison.head.agentDefinitionId)}
                <span className="ml-2 font-mono text-xs">{comparison.head.agentDefinitionId}</span>
              </p>
            </div>

            <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
              <RunCard title={t('agent_orchestrator.evalRegression.compare.base')} run={comparison.base} />
              <div className="hidden items-center justify-center md:flex">
                <ArrowRight className="size-5 text-muted-foreground" />
              </div>
              <RunCard title={t('agent_orchestrator.evalRegression.compare.head')} run={comparison.head} />
            </div>

            {comparison.sameDataset === false ? (
              <Alert status="warning" style="light" icon={<TriangleAlert className="size-4" />}>
                <div>
                  <AlertTitle>{t('agent_orchestrator.evalRegression.compare.datasetDrift.title')}</AlertTitle>
                  <AlertDescription>{t('agent_orchestrator.evalRegression.compare.datasetDrift.description')}</AlertDescription>
                </div>
              </Alert>
            ) : comparison.sameDataset === null ? (
              <p className="text-xs text-muted-foreground">{t('agent_orchestrator.evalRegression.compare.datasetUnknown')}</p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t('agent_orchestrator.evalRegression.compare.passScoreDelta')} testId="eval-compare-delta">
                <DeltaPoints value={comparison.passScoreDelta} />
              </Stat>
              <Stat label={t('agent_orchestrator.evalRegression.change.regressed')} testId="eval-compare-regressed">
                <span className={cn(comparison.totals.regressed > 0 && 'text-status-error-text')}>{comparison.totals.regressed}</span>
              </Stat>
              <Stat label={t('agent_orchestrator.evalRegression.change.fixed')} testId="eval-compare-fixed">
                <span className={cn(comparison.totals.fixed > 0 && 'text-status-success-text')}>{comparison.totals.fixed}</span>
              </Stat>
              <Stat label={t('agent_orchestrator.evalRegression.compare.otherChanges')}>
                {comparison.totals.changed + comparison.totals.added + comparison.totals.removed}
              </Stat>
            </div>

            <section className="space-y-2">
              <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.evalRegression.compare.assertions')}</h2>
              {comparison.assertions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalRegression.compare.noAssertions')}</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.assertion')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.severity')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.base')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.head')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.delta')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparison.assertions.map((assertion) => (
                        <TableRow key={assertion.key} data-testid={`eval-compare-assertion-${assertion.key}`}>
                          <TableCell>
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-foreground">{assertion.key}</span>
                              {assertion.judge ? (
                                <StatusBadge variant="info">{t('agent_orchestrator.evalRegression.compare.judge')}</StatusBadge>
                              ) : null}
                              {assertion.regressed ? (
                                <StatusBadge variant="error">{t('agent_orchestrator.evalRegression.compare.gateRegression')}</StatusBadge>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {assertion.severity === 'gate' || assertion.severity === 'warn'
                              ? t(`agent_orchestrator.evalAssertions.severity.${assertion.severity}`)
                              : assertion.severity}
                          </TableCell>
                          <TableCell className="tabular-nums">{formatPassScore(assertion.basePassRate) ?? '—'}</TableCell>
                          <TableCell className="tabular-nums">{formatPassScore(assertion.headPassRate) ?? '—'}</TableCell>
                          <TableCell>
                            <DeltaPoints value={assertion.delta} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">{t('agent_orchestrator.evalRegression.compare.cases')}</h2>
                <SegmentedControl value={filter} onValueChange={(value) => setFilter(value as CaseFilter)}>
                  <SegmentedControlItem value="changed">{t('agent_orchestrator.evalRegression.compare.filter.changed')}</SegmentedControlItem>
                  <SegmentedControlItem value="all">{t('agent_orchestrator.evalRegression.compare.filter.all')}</SegmentedControlItem>
                </SegmentedControl>
              </div>
              {visibleCases.length === 0 ? (
                <EmptyState
                  title={t('agent_orchestrator.evalRegression.compare.noChanges.title')}
                  description={t('agent_orchestrator.evalRegression.compare.noChanges.description')}
                />
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.case')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.change')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.base')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.head')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.score')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRegression.compare.col.flipped')}</TableHead>
                        <TableHead className="text-right">{t('agent_orchestrator.evalRegression.compare.col.traces')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleCases.map((entry) => (
                        <TableRow key={entry.caseId} data-testid={`eval-compare-case-${entry.caseId}`}>
                          <TableCell>
                            <span className="block font-medium text-foreground">{entry.name ?? entry.key}</span>
                            {entry.name && entry.key !== entry.caseId ? (
                              <span className="block font-mono text-xs text-muted-foreground">{entry.key}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <StatusBadge variant={caseChangeVariant[entry.change]}>
                              {t(`agent_orchestrator.evalRegression.change.${entry.change}`)}
                            </StatusBadge>
                          </TableCell>
                          <TableCell>
                            <CaseStatus status={entry.baseStatus} />
                          </TableCell>
                          <TableCell>
                            <CaseStatus status={entry.headStatus} />
                          </TableCell>
                          <TableCell>
                            <DeltaPoints value={entry.scoreDelta} />
                          </TableCell>
                          <TableCell>
                            {entry.flippedAssertions.length ? (
                              <ul className="flex flex-wrap gap-1">
                                {entry.flippedAssertions.map((flip) => (
                                  <li
                                    key={flip.key}
                                    className={cn(
                                      'rounded-md border border-border px-1.5 py-0.5 font-mono text-xs',
                                      flip.head === false ? 'text-status-error-text' : flip.head === true ? 'text-status-success-text' : 'text-muted-foreground',
                                    )}
                                  >
                                    {`${flip.key}: ${verdictLabel(t, flip.base)} → ${verdictLabel(t, flip.head)}`}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="inline-flex flex-wrap justify-end gap-3 text-sm">
                              {entry.baseAgentRunId ? (
                                <Link
                                  href={`/backend/traces/${encodeURIComponent(entry.baseAgentRunId)}`}
                                  className="text-muted-foreground underline-offset-2 hover:underline"
                                >
                                  {t('agent_orchestrator.evalRegression.compare.base')}
                                </Link>
                              ) : null}
                              {entry.headAgentRunId ? (
                                <Link
                                  href={`/backend/traces/${encodeURIComponent(entry.headAgentRunId)}`}
                                  className="font-medium text-foreground underline-offset-2 hover:underline"
                                >
                                  {t('agent_orchestrator.evalRegression.compare.head')}
                                </Link>
                              ) : null}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
