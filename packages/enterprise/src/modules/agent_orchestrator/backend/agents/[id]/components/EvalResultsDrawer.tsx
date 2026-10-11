"use client"

import * as React from 'react'
import Link from 'next/link'
import { MinusCircle, ShieldAlert } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
} from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatDurationMs } from '../../../../components/types'
import {
  evalCaseRunStatusVariant,
  evalSuiteOutcomeVariant,
  evalSuiteStatusVariant,
  evalVerdictState,
  evalVerdictVariant,
  formatPassScore,
  isTerminalCaseRunStatus,
  mapEvalCaseRun,
  mapEvalRunDetail,
  type EvalCaseRunRow,
  type EvalRunDetailView,
} from '../../../../components/evalRunTypes'

/** The route caps `pageSize` at 100; enough for a per-agent suite at a glance. */
const CASE_RUN_PAGE_SIZE = 100

type EvalRunDetailResponse = {
  run?: Record<string, unknown>
  caseRuns?: Array<Record<string, unknown>>
}

export type EvalResultsDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  suiteRunId: string | null
  agentLabel: string
}

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

/**
 * Read-only per-case-run results for one eval suite run
 * (`GET /eval-runs/{id}` → run + caseRuns). Shows pass / fail / skipped / error
 * per case with score; failed rows and safety regressions are highlighted.
 */
export function EvalResultsDrawer({ open, onOpenChange, suiteRunId, agentLabel }: EvalResultsDrawerProps) {
  const t = useT()
  const locale = useLocale()
  const [run, setRun] = React.useState<EvalRunDetailView | null>(null)
  const [caseRuns, setCaseRuns] = React.useState<EvalCaseRunRow[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [isError, setIsError] = React.useState(false)

  React.useEffect(() => {
    if (!open || !suiteRunId) {
      setRun(null)
      setCaseRuns([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    setIsError(false)
    void apiCall<EvalRunDetailResponse>(
      `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}?pageSize=${CASE_RUN_PAGE_SIZE}`,
      undefined,
      { fallback: {} },
    ).then((call) => {
      if (cancelled) return
      if (!call.ok || !call.result?.run) {
        setIsError(true)
        setIsLoading(false)
        return
      }
      setRun(mapEvalRunDetail(call.result.run))
      const items = Array.isArray(call.result.caseRuns) ? call.result.caseRuns : []
      setCaseRuns(items.map((item) => mapEvalCaseRun(item)).filter((row): row is EvalCaseRunRow => row !== null))
      setIsLoading(false)
    })
    return () => { cancelled = true }
  }, [open, suiteRunId])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="max-w-2xl">
        <DrawerHeader>
          <span className="text-xs font-medium uppercase tracking-wide text-brand-violet">
            {t('agent_orchestrator.agentDetail.evaluation.section.runs', 'Runs')}
          </span>
          <DrawerTitle>{t('agent_orchestrator.agentDetail.evaluation.results.title', 'Evaluation results')}</DrawerTitle>
          <DrawerDescription>{agentLabel}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="space-y-5 pb-6">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t('agent_orchestrator.agentDetail.evaluation.results.loading', 'Loading results…')}
            </div>
          ) : isError || !run ? (
            <p className="py-6 text-sm text-muted-foreground">
              {t('agent_orchestrator.evalRuns.detail.error')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge variant={evalSuiteStatusVariant[run.status]} dot>
                  {t(`agent_orchestrator.evalRuns.status.${run.status}`)}
                </StatusBadge>
                {run.outcome ? (
                  <StatusBadge variant={evalSuiteOutcomeVariant[run.outcome]}>
                    {t(`agent_orchestrator.evalRuns.outcome.${run.outcome}`)}
                  </StatusBadge>
                ) : null}
                {formatPassScore(run.passScore) ? (
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {t('agent_orchestrator.evalRuns.col.passScore')}: {formatPassScore(run.passScore)}
                  </span>
                ) : null}
                <Button asChild variant="ghost" size="sm" className="ml-auto">
                  <Link href={`/backend/eval-runs/${encodeURIComponent(run.id)}`}>
                    {t('agent_orchestrator.agentDetail.evaluation.results.openFull', 'Open full run')}
                  </Link>
                </Button>
              </div>

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

              <section className="space-y-2">
                <SectionHeader
                  title={t('agent_orchestrator.evalRuns.detail.caseRuns')}
                  count={caseRuns.length}
                />
                {caseRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('agent_orchestrator.evalRuns.detail.caseRunsEmpty')}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {caseRuns.map((caseRun) => {
                      const failed = caseRun.status === 'failed'
                      return (
                        <li
                          key={caseRun.id}
                          className={
                            failed
                              ? 'rounded-lg border border-status-error-border bg-status-error-bg/40 px-3 py-2'
                              : 'rounded-lg border border-border bg-background px-3 py-2'
                          }
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge variant={evalCaseRunStatusVariant[caseRun.status]} dot>
                              {t(`agent_orchestrator.evalRuns.caseStatus.${caseRun.status}`)}
                            </StatusBadge>
                            {isTerminalCaseRunStatus(caseRun.status) ? (
                              <VerdictBadge passed={caseRun.passed} />
                            ) : null}
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {t('agent_orchestrator.evalRuns.detail.trial')} {caseRun.trialIndex + 1}
                            </span>
                            {caseRun.score != null ? (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {t('agent_orchestrator.evalRuns.detail.score')}: {caseRun.score.toFixed(2)}
                              </span>
                            ) : null}
                            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                              {formatDurationMs(caseRun.latencyMs) ?? '—'}
                            </span>
                          </div>
                          {caseRun.errorMessage ? (
                            <p className="mt-1.5 text-xs text-status-warning-text">{caseRun.errorMessage}</p>
                          ) : null}
                          {caseRun.agentRunId ? (
                            <Button asChild variant="ghost" size="sm" className="mt-1 -ml-2">
                              <Link href={`/backend/traces/${encodeURIComponent(caseRun.agentRunId)}`}>
                                {t('agent_orchestrator.evalRuns.detail.openTrace')}
                              </Link>
                            </Button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <p className="text-xs tabular-nums text-muted-foreground">
                {formatDateTime(run.startedAt ?? run.createdAt, locale) ?? '—'}
              </p>
            </>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}

export default EvalResultsDrawer
