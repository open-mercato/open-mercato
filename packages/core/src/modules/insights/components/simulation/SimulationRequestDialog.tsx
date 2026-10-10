"use client"

import * as React from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  SIMULATION_WINDOW_DAY_OPTIONS,
  defaultSimulationWindowDays,
  isActiveSimulationStatus,
  readSimulationMutationError,
  simulationRunPagePath,
} from '../../lib/client/simulation/api'
import { describeSimulationError, describeSimulationRunError, simulationEmptyResult, translateSimulationKey } from '../../lib/client/simulation/format'
import { useSimulationLiveRecords, useSimulationMutations, useSimulationRun } from '../../lib/client/simulation/hooks'
import type { SimulationCapabilities, SimulationExecution, SimulationRequestError } from '../../lib/client/simulation/types'
import { formatCount } from '../../lib/client/xray/format'
import { SimulationLiveRecords } from './SimulationLiveRecords'
import { SimulationGroupHeadline } from './SimulationResultGroups'
import { SimulationResultSummary } from './SimulationResultSummary'
import { SimulationStatusBadge } from './SimulationStatusBadge'

/** Live records shown in the dialog (the result page lists them all). */
const DIALOG_RECORDS_PAGE_SIZE = 10

const UNKNOWN_REQUEST_ERROR: SimulationRequestError = { httpStatus: null, code: null, message: null, issues: [] }

export type SimulationRequestDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: string
  artifactId: string | null
  limits: SimulationCapabilities['limits']
  /** Reads the CURRENT proposal when the user submits (never a stale copy). */
  buildProposal: () => unknown
  contextId: string
  title: string
  description: string
  /** Called once per run when it completes. */
  onCompleted?: (runId: string) => void
  /** What applying means in the owning editor (defaults to the rule editor's wording). */
  decisionHint?: string
  /** `inline` kinds are computed at once from the live configuration: no history window to choose. */
  execution?: SimulationExecution
}

function RequestErrorNotice({ error }: { error: SimulationRequestError }) {
  const t = useT()
  if (error.code === 'invalid_proposal' && error.issues.length > 0) {
    return (
      <Alert status="error" size="default" data-testid="simulation-request-issues">
        <AlertTitle>{t('insights.simulation.errors.invalid_proposal')}</AlertTitle>
        <AlertDescription>
          <span className="block">{t('insights.simulation.ui.simulate.issuesTitle')}</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {error.issues.map((issue, index) => (
              <li key={`${issue.path}:${index}`}>
                {issue.path
                  ? t('insights.simulation.ui.simulate.issue', { path: issue.path, message: translateSimulationKey(issue.message, t) })
                  : translateSimulationKey(issue.message, t)}
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <div data-testid="simulation-request-error">
      <ErrorMessage label={describeSimulationError(error, t, 'insights.simulation.ui.errors.requestFailed')} />
    </div>
  )
}

/**
 * Requests a simulation of the current, unsaved proposal (Cmd/Ctrl+Enter submits, Escape
 * closes), then follows the run: status text + icon with a guarded Cancel while it is queued or
 * running (refreshed every 2 s), headline counts per event with "fewer than k" / hidden cells and
 * warnings when it completes, and a link to the full result. Closing keeps the run going.
 */
export function SimulationRequestDialog({
  open,
  onOpenChange,
  kind,
  artifactId,
  limits,
  buildProposal,
  contextId,
  title,
  description,
  onCompleted,
  decisionHint,
  execution = 'queued',
}: SimulationRequestDialogProps) {
  const t = useT()
  const locale = useLocale()
  const windowLabelId = React.useId()
  const { requestSimulation, cancelRun } = useSimulationMutations(contextId)
  const windowOptions = React.useMemo(
    () => SIMULATION_WINDOW_DAY_OPTIONS.filter((days) => !limits.maxWindowDays || days <= limits.maxWindowDays),
    [limits.maxWindowDays],
  )
  const [windowDays, setWindowDays] = React.useState(() => defaultSimulationWindowDays(limits.defaultWindowDays, limits.maxWindowDays))
  const [runId, setRunId] = React.useState<string | null>(null)
  const [deduplicated, setDeduplicated] = React.useState(false)
  const [requestError, setRequestError] = React.useState<SimulationRequestError | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const inline = execution === 'inline'
  const run = useSimulationRun(runId, { poll: true })
  const detail = run.data && run.data.id === runId ? run.data : null
  const active = detail ? isActiveSimulationStatus(detail.status) : runId !== null
  const records = useSimulationLiveRecords(runId, 1, {
    enabled: detail?.status === 'completed' && detail.hasLiveRecords === true,
    pageSize: DIALOG_RECORDS_PAGE_SIZE,
  })
  const groupLabels = records.data?.groupLabels ?? null
  const statusRef = React.useRef<HTMLDivElement | null>(null)
  const completedRef = React.useRef<string | null>(null)
  const onCompletedRef = React.useRef(onCompleted)
  React.useEffect(() => {
    onCompletedRef.current = onCompleted
  })

  React.useEffect(() => {
    if (!detail || detail.status !== 'completed' || completedRef.current === detail.id) return
    completedRef.current = detail.id
    onCompletedRef.current?.(detail.id)
  }, [detail])

  React.useEffect(() => {
    if (runId && open) statusRef.current?.focus()
  }, [open, runId])

  const submit = React.useCallback(async () => {
    if (submitting || runId !== null) return
    setSubmitting(true)
    setRequestError(null)
    try {
      const response = await requestSimulation(inline
        ? { kind, artifactId, proposal: buildProposal() }
        : { kind, artifactId, proposal: buildProposal(), window: { days: windowDays } })
      if (!response) {
        setRequestError(UNKNOWN_REQUEST_ERROR)
        return
      }
      setDeduplicated(response.deduplicated)
      setRunId(response.runId)
    } catch (error) {
      setRequestError(readSimulationMutationError(error))
    } finally {
      setSubmitting(false)
    }
  }, [artifactId, buildProposal, inline, kind, requestSimulation, runId, submitting, windowDays])

  const cancel = React.useCallback(async () => {
    if (!runId || cancelling) return
    setCancelling(true)
    try {
      await cancelRun(runId)
    } catch (error) {
      const parsed = readSimulationMutationError(error)
      if (parsed.code !== 'run_not_active') flash(describeSimulationError(parsed, t, 'insights.simulation.ui.errors.cancelFailed'), 'error')
    } finally {
      setCancelling(false)
      run.reload()
    }
  }, [cancelRun, cancelling, run, runId, t])

  const startOver = React.useCallback(() => {
    setRunId(null)
    setDeduplicated(false)
    setRequestError(null)
  }, [])

  const handleKeyDown = useDialogKeyHandler({ onConfirm: () => { void submit() }, disabled: runId !== null || submitting })
  const runError = detail ? describeSimulationRunError(detail.errorCode, t) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onKeyDown={handleKeyDown} data-testid="simulation-request-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {runId === null ? (
          <div className="space-y-4">
            {inline ? (
              <p className="text-sm text-muted-foreground" data-testid="simulation-request-inline-help">{t('insights.simulation.ui.simulate.inlineHelp')}</p>
            ) : (
              <div className="space-y-2">
                <p id={windowLabelId} className="text-sm font-medium">{t('insights.simulation.ui.simulate.window')}</p>
                <SegmentedControl
                  value={String(windowDays)}
                  onValueChange={(next) => {
                    const days = Number(next)
                    if (windowOptions.some((option) => option === days)) setWindowDays(days)
                  }}
                  aria-labelledby={windowLabelId}
                  disabled={submitting}
                >
                  {windowOptions.map((days) => (
                    <SegmentedControlItem key={days} value={String(days)}>
                      {t('insights.simulation.ui.simulate.windowOption', { days: formatCount(days, locale) })}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                <p className="text-xs text-muted-foreground">{t('insights.simulation.ui.simulate.windowHelp')}</p>
              </div>
            )}
            {submitting ? <LoadingMessage label={t('insights.simulation.ui.simulate.submitting')} /> : null}
            {requestError ? <RequestErrorNotice error={requestError} /> : null}
          </div>
        ) : (
          <div ref={statusRef} tabIndex={-1} className="space-y-4 outline-none" data-testid="simulation-request-run">
            {deduplicated ? <p className="text-sm text-muted-foreground">{t('insights.simulation.ui.simulate.deduplicated')}</p> : null}
            {!detail && run.error ? <ErrorMessage label={describeSimulationError(run.error, t)} /> : null}
            {!detail && !run.error ? <LoadingMessage label={t('insights.simulation.ui.loadingRun')} /> : null}
            {detail ? (
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                <SimulationStatusBadge status={detail.status} />
                {active ? (
                  <span className="text-sm text-muted-foreground">
                    {t(detail.status === 'queued' ? 'insights.simulation.ui.run.queued' : 'insights.simulation.ui.run.running')}
                  </span>
                ) : null}
              </div>
            ) : null}
            {detail && active && run.error ? (
              <ErrorMessage
                label={describeSimulationError(run.error, t)}
                action={(
                  <Button type="button" variant="outline" size="sm" onClick={run.reload} data-testid="simulation-request-retry">
                    {t('insights.simulation.ui.actions.retry')}
                  </Button>
                )}
              />
            ) : null}
            {detail?.status === 'failed' ? (
              <Alert status="error" size="default">
                <AlertTitle>{t('insights.simulation.ui.run.failedTitle')}</AlertTitle>
                <AlertDescription>{runError ?? t('insights.simulation.errorCodes.internal')}</AlertDescription>
              </Alert>
            ) : null}
            {detail?.status === 'cancelled' ? (
              <Alert status="warning" size="default">
                <AlertTitle>{t('insights.simulation.ui.run.cancelledTitle')}</AlertTitle>
                <AlertDescription>{runError ?? t('insights.simulation.ui.run.cancelledDescription')}</AlertDescription>
              </Alert>
            ) : null}
            {detail?.status === 'completed' && detail.result ? (
              <div className="space-y-3" data-testid="simulation-request-result">
                {detail.result.truncated ? (
                  <Alert status="warning" size="default">
                    <AlertTitle>{t('insights.simulation.ui.run.truncatedTitle')}</AlertTitle>
                    <AlertDescription>{t('insights.simulation.ui.run.truncatedDescription')}</AlertDescription>
                  </Alert>
                ) : null}
                <SimulationResultSummary kind={detail.kind} summary={detail.result.summary} compact />
                {detail.result.groups.length === 0 ? (
                  <EmptyState size="sm" variant="subtle" {...simulationEmptyResult(detail.kind, t)} />
                ) : (
                  detail.result.groups.map((group) => (
                    <SimulationGroupHeadline key={group.key} kind={detail.kind} group={group} k={detail.result?.k ?? 0} proposal={detail.proposal} groupLabels={groupLabels} />
                  ))
                )}
                {detail.hasLiveRecords ? <SimulationLiveRecords kind={detail.kind} records={records} page={1} compact /> : null}
                <p className="text-xs text-muted-foreground">{decisionHint ?? t('insights.simulation.ui.simulate.decisionHint')}</p>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {runId === null ? t('insights.simulation.ui.actions.cancelDialog') : t('insights.simulation.ui.actions.close')}
          </Button>
          {runId === null ? (
            <Button type="button" onClick={() => { void submit() }} disabled={submitting} data-testid="simulation-request-submit">
              {t('insights.simulation.ui.simulate.submit')}
            </Button>
          ) : null}
          {runId !== null && active ? (
            <Button type="button" variant="outline" onClick={() => { void cancel() }} disabled={cancelling || !detail} data-testid="simulation-request-cancel">
              {t('insights.simulation.ui.actions.cancel')}
            </Button>
          ) : null}
          {runId !== null && !active ? (
            <Button type="button" variant="outline" onClick={startOver} data-testid="simulation-request-again">
              {t('insights.simulation.ui.simulate.again')}
            </Button>
          ) : null}
          {runId !== null ? (
            <Button asChild variant={detail?.status === 'completed' ? 'default' : 'outline'}>
              <Link href={simulationRunPagePath(runId)} data-testid="simulation-request-open-result">
                {t('insights.simulation.ui.simulate.openResult')}
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
