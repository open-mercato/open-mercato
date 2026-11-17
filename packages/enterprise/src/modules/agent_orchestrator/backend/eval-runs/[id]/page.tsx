"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  Gauge,
  MinusCircle,
  Octagon,
  ScrollText,
  ShieldAlert,
  Sigma,
  TriangleAlert,
} from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader, CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useCoalescedReload } from '../../../components/useCoalescedReload'
import { formatDateTime, formatDurationMs } from '../../../components/types'
import { agentLabelFor, useAgentLabelMap } from '../../../components/useAgentLabels'
import {
  evalCaseRunStatusVariant,
  evalSuiteOutcomeVariant,
  evalSuiteStatusVariant,
  evalVerdictState,
  evalVerdictVariant,
  formatCaseRunCost,
  formatPassScore,
  formatScoreVariance,
  isActiveSuiteStatus,
  isTerminalCaseRunStatus,
  mapEvalAssertionResult,
  mapEvalCase,
  mapEvalCaseRun,
  mapEvalRunDetail,
  parseCaseRunStatus,
  readEvidenceMismatches,
  residualEvidence,
  type EvalAssertionResultRow,
  type EvalCaseRunRow,
  type EvalCaseView,
  type EvalRunDetailView,
} from '../../../components/evalRunTypes'

/** The route caps `pageSize` at 100; a suite can hold up to 500 case runs. */
const CASE_RUN_PAGE_SIZE = 100

type EvalRunDetailResponse = {
  run?: Record<string, unknown>
  caseRuns?: Array<Record<string, unknown>>
  nextCursor?: string | null
}

type ResultsResponse = { items?: Array<Record<string, unknown>> }

type ResultsState = {
  status: 'loading' | 'ready' | 'error'
  items: EvalAssertionResultRow[]
}

type EvalCaseState = {
  status: 'loading' | 'ready' | 'error'
  evalCase: EvalCaseView | null
}

function readEventString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Three-state verdict cell: `null` renders as SKIPPED — muted, never red. */
function VerdictBadge({ passed }: { passed: boolean | null }) {
  const t = useT()
  const state = evalVerdictState(passed)
  return (
    <StatusBadge variant={evalVerdictVariant[state]} dot={state !== 'skipped'}>
      {state === 'skipped' ? (
        <span className="inline-flex items-center gap-1">
          <MinusCircle className="size-3 shrink-0" />
          {t('agent_orchestrator.evalRuns.verdict.skipped')}
        </span>
      ) : (
        t(`agent_orchestrator.evalRuns.verdict.${state}`)
      )}
    </StatusBadge>
  )
}

function HeaderStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'warning'
}) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p
        className={cn(
          'mt-1 text-xl font-bold tabular-nums tracking-tight',
          tone === 'warning' ? 'text-status-warning-text' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * A mismatched value, rendered so `null`, `""` and a missing key stay
 * distinguishable — the whole point of reading a diff.
 */
function MismatchValue({ value }: { value: unknown }) {
  const t = useT()
  if (value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  if (value === null) {
    return <span className="italic text-muted-foreground">{t('agent_orchestrator.evalRuns.detail.valueNull')}</span>
  }
  if (typeof value === 'string' && value.length === 0) {
    return <span className="italic text-muted-foreground">{t('agent_orchestrator.evalRuns.detail.valueEmpty')}</span>
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return <span className="font-mono text-xs break-words">{text}</span>
}

/**
 * Expected-vs-actual per diverging path. Without it the operator sees only WHICH
 * fields disagreed and has to open the trace and the eval case side by side to
 * learn HOW.
 */
function MismatchTable({ evidence }: { evidence: unknown }) {
  const t = useT()
  const { rows, omitted } = readEvidenceMismatches(evidence)
  if (rows.length === 0) return null
  const hasValues = rows.some((row) => row.expected !== undefined || row.actual !== undefined)
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('agent_orchestrator.evalRuns.detail.mismatchPath')}</TableHead>
            {hasValues ? (
              <>
                <TableHead>{t('agent_orchestrator.evalRuns.detail.mismatchExpected')}</TableHead>
                <TableHead>{t('agent_orchestrator.evalRuns.detail.mismatchActual')}</TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.path}>
              <TableCell className="align-top font-mono text-xs">{row.path}</TableCell>
              {hasValues ? (
                <>
                  <TableCell className="align-top text-status-success-text">
                    <MismatchValue value={row.expected} />
                  </TableCell>
                  <TableCell className="align-top text-status-error-text">
                    <MismatchValue value={row.actual} />
                  </TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {omitted > 0 ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {t('agent_orchestrator.evalRuns.detail.mismatchOmitted', undefined, { count: omitted })}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The golden record the case run was scored against. Fetched per expanded row
 * from the single-case route, because `input`/`expected` are encrypted at rest
 * and are never projected into a list response.
 */
function GoldenCase({ state, evalCaseId }: { state: EvalCaseState; evalCaseId: string }) {
  const t = useT()
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {t('agent_orchestrator.evalRuns.detail.goldenLoading')}
      </div>
    )
  }
  if (state.status === 'error' || !state.evalCase) {
    return <p className="py-2 text-sm text-muted-foreground">{t('agent_orchestrator.evalRuns.detail.goldenError')}</p>
  }
  const evalCase = state.evalCase
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant="neutral">{evalCase.status}</StatusBadge>
        <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {evalCase.sourceType}
        </span>
        {evalCase.processType ? (
          <span className="font-mono text-xs text-muted-foreground">{evalCase.processType}</span>
        ) : null}
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <Link href={`/backend/eval-cases/${encodeURIComponent(evalCaseId)}`}>
            {t('agent_orchestrator.evalRuns.detail.openEvalCase')}
          </Link>
        </Button>
      </div>
      {evalCase.expected != null ? (
        <JsonDisplay
          data={evalCase.expected}
          title={t('agent_orchestrator.evalRuns.detail.goldenExpected')}
          maxHeight="20rem"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.evalRuns.detail.goldenNoExpected')}</p>
      )}
      {evalCase.input != null ? (
        <JsonDisplay
          data={evalCase.input}
          title={t('agent_orchestrator.evalRuns.detail.goldenInput')}
          maxHeight="16rem"
        />
      ) : null}
    </div>
  )
}

function AssertionResults({ state }: { state: ResultsState }) {
  const t = useT()
  const locale = useLocale()
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {t('agent_orchestrator.evalRuns.detail.resultsLoading')}
      </div>
    )
  }
  if (state.status === 'error') {
    return <ErrorMessage label={t('agent_orchestrator.evalRuns.detail.resultsError')} />
  }
  if (state.items.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t('agent_orchestrator.evalRuns.detail.resultsEmpty')}</p>
  }
  return (
    <ul className="space-y-1.5">
      {state.items.map((result) => {
        const residual = residualEvidence(result.evidence)
        return (
          <li key={result.id} className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge passed={result.passed} />
              <span className="font-mono text-xs text-foreground">{result.assertionKey}</span>
              <StatusBadge variant={result.severity === 'gate' ? 'error' : 'warning'}>
                {t(`agent_orchestrator.evalRuns.severity.${result.severity}`)}
              </StatusBadge>
              {result.score != null ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('agent_orchestrator.evalRuns.detail.resultScore', undefined, { value: result.score.toFixed(2) })}
                </span>
              ) : null}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {formatDateTime(result.evaluatedAt, locale) ?? '—'}
              </span>
            </div>
            <MismatchTable evidence={result.evidence} />
            {residual != null ? (
              <div className="mt-2">
                <JsonDisplay
                  data={residual}
                  title={t('agent_orchestrator.evalRuns.detail.resultEvidence')}
                  maxHeight="16rem"
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export default function AgentEvalRunDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const agentLabels = useAgentLabelMap()
  const suiteRunId = params?.id ?? ''

  const [run, setRun] = React.useState<EvalRunDetailView | null>(null)
  const [caseRuns, setCaseRuns] = React.useState<EvalCaseRunRow[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<Record<string, ResultsState>>({})
  const [evalCases, setEvalCases] = React.useState<Record<string, EvalCaseState>>({})
  const [isCancelling, setIsCancelling] = React.useState(false)
  const loadedRunRef = React.useRef<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: 'agent_orchestrator.evalRuns',
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      // Live-driven reloads of an already-rendered suite refetch silently, so the
      // page does not flash a loading state while the operator is reading it.
      const silent = loadedRunRef.current === suiteRunId
      if (!silent) setIsLoading(true)
      setError(null)
      const call = await apiCall<EvalRunDetailResponse>(
        `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}?pageSize=${CASE_RUN_PAGE_SIZE}`,
        undefined,
        { fallback: {} },
      )
      if (cancelled) return
      if (!call.ok || !call.result?.run) {
        setError(t('agent_orchestrator.evalRuns.detail.error'))
        setIsLoading(false)
        return
      }
      loadedRunRef.current = suiteRunId
      setRun(mapEvalRunDetail(call.result.run))
      const items = Array.isArray(call.result.caseRuns) ? call.result.caseRuns : []
      setCaseRuns(items.map((item) => mapEvalCaseRun(item)).filter((row): row is EvalCaseRunRow => row !== null))
      setNextCursor(call.result.nextCursor ?? null)
      setIsLoading(false)
    }
    if (suiteRunId) void load()
    return () => { cancelled = true }
  }, [t, suiteRunId, reloadToken])

  const loadMore = React.useCallback(async () => {
    if (!nextCursor) return
    setIsLoadingMore(true)
    const params = new URLSearchParams({ pageSize: String(CASE_RUN_PAGE_SIZE), after: nextCursor })
    const call = await apiCall<EvalRunDetailResponse>(
      `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}?${params.toString()}`,
      undefined,
      { fallback: {} },
    )
    if (!call.ok) {
      flash(t('agent_orchestrator.evalRuns.detail.loadMoreError'), 'error')
      setIsLoadingMore(false)
      return
    }
    const items = Array.isArray(call.result?.caseRuns) ? call.result.caseRuns : []
    const mapped = items.map((item) => mapEvalCaseRun(item)).filter((row): row is EvalCaseRunRow => row !== null)
    setCaseRuns((current) => {
      const known = new Set(current.map((row) => row.id))
      return [...current, ...mapped.filter((row) => !known.has(row.id))]
    })
    setNextCursor(call.result?.nextCursor ?? null)
    setIsLoadingMore(false)
  }, [nextCursor, suiteRunId, t])

  /**
   * Lazy by contract: the detail endpoint deliberately does not inline assertion
   * results, so they are fetched on FIRST expansion only. `requestedResultsRef`
   * makes that "first" exact — a re-expand never refires an in-flight request.
   */
  const requestedResultsRef = React.useRef<Set<string>>(new Set())
  /**
   * The golden case is fetched per eval case, NOT per case run: a suite at
   * repeatCount 3 expands three rows that share one case, and refetching the same
   * encrypted payload per trial buys nothing.
   */
  const requestedCasesRef = React.useRef<Set<string>>(new Set())

  const loadEvalCase = React.useCallback((evalCaseId: string) => {
    if (!evalCaseId || requestedCasesRef.current.has(evalCaseId)) return
    requestedCasesRef.current.add(evalCaseId)
    setEvalCases((current) => ({ ...current, [evalCaseId]: { status: 'loading', evalCase: null } }))
    void (async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/eval-cases/${encodeURIComponent(evalCaseId)}`,
        undefined,
        { fallback: {} },
      )
      const mapped = call.ok && call.result ? mapEvalCase(call.result) : null
      if (!mapped) {
        // Dropped from the requested set so collapsing and re-expanding retries.
        requestedCasesRef.current.delete(evalCaseId)
        setEvalCases((current) => ({ ...current, [evalCaseId]: { status: 'error', evalCase: null } }))
        return
      }
      setEvalCases((current) => ({ ...current, [evalCaseId]: { status: 'ready', evalCase: mapped } }))
    })()
  }, [])

  const toggleExpanded = React.useCallback((caseRunId: string, evalCaseId: string) => {
    setExpandedId((current) => (current === caseRunId ? null : caseRunId))
    loadEvalCase(evalCaseId)
    if (requestedResultsRef.current.has(caseRunId)) return
    requestedResultsRef.current.add(caseRunId)
    setResults((current) => ({ ...current, [caseRunId]: { status: 'loading', items: [] } }))
    void (async () => {
      const call = await apiCall<ResultsResponse>(
        `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}/case-runs/${encodeURIComponent(caseRunId)}/results`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!call.ok) {
        // Dropped from the requested set so the operator can retry by collapsing
        // and re-expanding the row.
        requestedResultsRef.current.delete(caseRunId)
        setResults((current) => ({ ...current, [caseRunId]: { status: 'error', items: [] } }))
        return
      }
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setResults((current) => ({
        ...current,
        [caseRunId]: {
          status: 'ready',
          items: items
            .map((item) => mapEvalAssertionResult(item))
            .filter((row): row is EvalAssertionResultRow => row !== null),
        },
      }))
    })()
  }, [suiteRunId, loadEvalCase])

  // Live progress: case-run events patch the loaded rows in place (no refetch of
  // a list the very run is still writing). The suite-completion event refreshes
  // the aggregates, coalesced against event bursts.
  const patchCaseRun = React.useCallback((payload: Record<string, unknown>) => {
    if (readEventString(payload, 'suiteRunId') !== suiteRunId) return
    const caseRunId = readEventString(payload, 'id')
    if (!caseRunId) return
    setCaseRuns((current) => {
      const index = current.findIndex((row) => row.id === caseRunId)
      if (index < 0) return current
      const patched = [...current]
      const passed = payload.passed
      const score = payload.score
      patched[index] = {
        ...patched[index],
        status: parseCaseRunStatus(payload.status) ?? patched[index].status,
        passed: typeof passed === 'boolean' ? passed : null,
        score: typeof score === 'number' && Number.isFinite(score) ? score : null,
      }
      return patched
    })
  }, [suiteRunId])

  useAppEvent('agent_orchestrator.eval_case_run.started', (event) => { patchCaseRun(event.payload) }, [patchCaseRun])
  useAppEvent('agent_orchestrator.eval_case_run.completed', (event) => { patchCaseRun(event.payload) }, [patchCaseRun])

  const coalescedReload = useCoalescedReload(
    React.useCallback(() => setReloadToken((token) => token + 1), []),
  )
  useAppEvent(
    'agent_orchestrator.eval_suite_run.completed',
    (event) => {
      if (readEventString(event.payload, 'id') === suiteRunId) coalescedReload()
    },
    [suiteRunId, coalescedReload],
  )

  const cancelRun = React.useCallback(async () => {
    setIsCancelling(true)
    try {
      let nextStatus: string | null = null
      await runMutation({
        operation: async () => {
          const call = await apiCallOrThrow<{ suiteRunId: string; status: string }>(
            `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}/cancel`,
            { method: 'POST' },
          )
          nextStatus = call.result?.status ?? null
        },
        context: { retryLastMutation },
      })
      flash(t('agent_orchestrator.evalRuns.detail.cancelDone'), 'success')
      if (nextStatus) setReloadToken((token) => token + 1)
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.evalRuns.detail.cancelError'), 'error')
    } finally {
      setIsCancelling(false)
    }
  }, [runMutation, retryLastMutation, suiteRunId, t])

  const completedCount = React.useMemo(
    () => caseRuns.filter((row) => isTerminalCaseRunStatus(row.status)).length,
    [caseRuns],
  )

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
                run
                  ? `/backend/agents/${encodeURIComponent(run.agentDefinitionId)}?tab=evaluation&section=runs`
                  : '/backend/agents',
              )
            }
          >
            {t('agent_orchestrator.evalRuns.detail.back')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('agent_orchestrator.evalRuns.detail.title')} />
        ) : error ? (
          <ErrorMessage label={error} />
        ) : !run ? (
          <ErrorMessage label={t('agent_orchestrator.evalRuns.detail.error')} />
        ) : (
          <div className="space-y-6">
            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={evalSuiteStatusVariant[run.status]} dot>
                    {t(`agent_orchestrator.evalRuns.status.${run.status}`)}
                  </StatusBadge>
                  {run.outcome ? (
                    <StatusBadge variant={evalSuiteOutcomeVariant[run.outcome]}>
                      {t(`agent_orchestrator.evalRuns.outcome.${run.outcome}`)}
                    </StatusBadge>
                  ) : null}
                  <StatusBadge variant={run.judgeMayGate ? 'warning' : 'neutral'}>
                    {run.judgeMayGate
                      ? t('agent_orchestrator.evalRuns.detail.judgeMayGate')
                      : t('agent_orchestrator.evalRuns.detail.judgeAdvisory')}
                  </StatusBadge>
                  <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {t(`agent_orchestrator.evalRuns.trigger.${run.trigger}`)}
                  </span>
                  {run.evalSetVersion ? (
                    <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {run.evalSetVersion}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                      {agentLabelFor(agentLabels, run.agentDefinitionId)}
                    </h1>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{run.agentDefinitionId}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {t('agent_orchestrator.evalRuns.detail.startedAt', undefined, {
                        value: formatDateTime(run.startedAt ?? run.createdAt, locale) ?? '—',
                      })}
                      {run.finishedAt
                        ? ` · ${t('agent_orchestrator.evalRuns.finishedAt', undefined, {
                            value: formatDateTime(run.finishedAt, locale) ?? '—',
                          })}`
                        : ''}
                    </p>
                  </div>
                  {isActiveSuiteStatus(run.status) ? (
                    <Button type="button" variant="outline" size="sm" onClick={cancelRun} disabled={isCancelling}>
                      <Octagon className="size-4" />
                      {t('agent_orchestrator.evalRuns.detail.cancel')}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px border-t border-border bg-border lg:grid-cols-4">
                <HeaderStat
                  label={t('agent_orchestrator.evalRuns.col.passScore')}
                  value={formatPassScore(run.passScore) ?? '—'}
                  icon={Gauge}
                />
                <HeaderStat
                  label={t('agent_orchestrator.evalRuns.detail.scoreVariance')}
                  value={formatScoreVariance(run.scoreVariance) ?? '—'}
                  icon={Sigma}
                />
                <HeaderStat
                  label={t('agent_orchestrator.evalRuns.col.cases')}
                  value={t('agent_orchestrator.evalRuns.detail.caseCountValue', undefined, {
                    // `caseCount` is already cases × repeats (commands/evalRuns.ts
                    // stores the product), so multiplying again in the label read
                    // "15 × 3" for a 5-case suite at 3 repeats.
                    cases: run.repeatCount > 0 ? run.caseCount / run.repeatCount : run.caseCount,
                    repeats: run.repeatCount,
                  })}
                  icon={ScrollText}
                />
                <HeaderStat
                  label={t('agent_orchestrator.evalRuns.detail.errorCount')}
                  value={String(run.errorCount)}
                  icon={TriangleAlert}
                  tone={run.errorCount > 0 ? 'warning' : 'default'}
                />
              </div>
            </section>

            {run.safetyRegressions.length > 0 ? (
              <Alert status="error" style="light" icon={<ShieldAlert className="size-4" />}>
                <div>
                  <AlertTitle>{t('agent_orchestrator.evalRuns.detail.safetyRegressionsTitle')}</AlertTitle>
                  <AlertDescription>
                    {t('agent_orchestrator.evalRuns.detail.safetyRegressionsDescription', undefined, {
                      count: run.safetyRegressions.length,
                    })}
                  </AlertDescription>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {run.safetyRegressions.map((key) => (
                      <li
                        key={key}
                        className="rounded-md border border-status-error-border bg-status-error-bg px-1.5 py-0.5 font-mono text-xs text-status-error-text"
                      >
                        {key}
                      </li>
                    ))}
                  </ul>
                </div>
              </Alert>
            ) : null}

            {isActiveSuiteStatus(run.status) ? (
              <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <Progress
                  value={run.caseCount > 0 ? Math.min(100, Math.round((completedCount / run.caseCount) * 100)) : 0}
                  tone="accent"
                  label={t('agent_orchestrator.evalRuns.detail.progressLabel', undefined, {
                    completed: completedCount,
                    total: run.caseCount,
                  })}
                  showValue
                />
                {nextCursor ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('agent_orchestrator.evalRuns.detail.progressPartial')}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3">
              <SectionHeader
                title={t('agent_orchestrator.evalRuns.detail.caseRuns')}
                count={caseRuns.length}
              />
              {caseRuns.length === 0 ? (
                <EmptyState
                  title={t('agent_orchestrator.evalRuns.detail.caseRunsEmpty')}
                  description={t('agent_orchestrator.evalRuns.detail.caseRunsEmptyDescription')}
                />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>{t('agent_orchestrator.evalRuns.col.status')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRuns.detail.trial')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRuns.detail.verdict')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRuns.detail.score')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRuns.detail.latency')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRuns.detail.cost')}</TableHead>
                        <TableHead>{t('agent_orchestrator.evalRuns.detail.trace')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {caseRuns.map((caseRun) => {
                        const expanded = expandedId === caseRun.id
                        return (
                          <React.Fragment key={caseRun.id}>
                            <TableRow>
                              <TableCell>
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-expanded={expanded}
                                  aria-label={
                                    expanded
                                      ? t('agent_orchestrator.evalRuns.detail.collapseResults')
                                      : t('agent_orchestrator.evalRuns.detail.expandResults')
                                  }
                                  onClick={() => toggleExpanded(caseRun.id, caseRun.evalCaseId)}
                                >
                                  <ChevronDown className={cn('size-4 transition-transform', !expanded && '-rotate-90')} />
                                </IconButton>
                              </TableCell>
                              <TableCell>
                                <StatusBadge variant={evalCaseRunStatusVariant[caseRun.status]} dot>
                                  {t(`agent_orchestrator.evalRuns.caseStatus.${caseRun.status}`)}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className="tabular-nums text-muted-foreground">
                                {caseRun.trialIndex + 1}
                              </TableCell>
                              <TableCell>
                                {/*
                                  A case run that has not finished has NO verdict —
                                  which is not the same as `passed: null`, whose
                                  meaning is the positive claim "skipped: the
                                  assertion did not apply". Rendering a pending row
                                  as "Skipped" contradicts the status badge beside
                                  it and tells the operator a running suite skipped
                                  everything.
                                */}
                                {isTerminalCaseRunStatus(caseRun.status) ? (
                                  <VerdictBadge passed={caseRun.passed} />
                                ) : (
                                  <span className="text-sm text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {caseRun.score != null ? caseRun.score.toFixed(2) : '—'}
                              </TableCell>
                              <TableCell className="tabular-nums text-muted-foreground">
                                {formatDurationMs(caseRun.latencyMs) ?? '—'}
                              </TableCell>
                              <TableCell
                                className="tabular-nums text-muted-foreground"
                                title={t('agent_orchestrator.evalRuns.detail.costTooltip')}
                              >
                                {formatCaseRunCost(caseRun.costMinor) ?? '—'}
                              </TableCell>
                              <TableCell>
                                {caseRun.agentRunId ? (
                                  <Button asChild variant="ghost" size="sm">
                                    <Link href={`/backend/traces/${encodeURIComponent(caseRun.agentRunId)}`}>
                                      {t('agent_orchestrator.evalRuns.detail.openTrace')}
                                    </Link>
                                  </Button>
                                ) : (
                                  <span className="text-sm text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                            {expanded ? (
                              <TableRow>
                                <TableCell colSpan={8} className="bg-muted/30">
                                  {caseRun.errorMessage ? (
                                    <Alert status="warning" style="lighter" size="sm" className="mb-3">
                                      {caseRun.errorMessage}
                                    </Alert>
                                  ) : null}
                                  <AssertionResults
                                    state={results[caseRun.id] ?? { status: 'loading', items: [] }}
                                  />
                                  <div className="mt-3">
                                    <CollapsibleSection
                                      title={t('agent_orchestrator.evalRuns.detail.goldenCase')}
                                      defaultCollapsed
                                    >
                                      <GoldenCase
                                        state={
                                          evalCases[caseRun.evalCaseId] ?? { status: 'loading', evalCase: null }
                                        }
                                        evalCaseId={caseRun.evalCaseId}
                                      />
                                    </CollapsibleSection>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </React.Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {nextCursor ? (
                <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={isLoadingMore}>
                  {isLoadingMore ? <Spinner className="size-4" /> : null}
                  {t('agent_orchestrator.evalRuns.detail.loadMore')}
                </Button>
              ) : null}
            </section>

            {run.summary != null ? (
              <CollapsibleSection title={t('agent_orchestrator.evalRuns.detail.summary')} defaultCollapsed>
                <JsonDisplay data={run.summary} maxHeight="24rem" />
              </CollapsibleSection>
            ) : null}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
