"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, CheckCircle2, CircleHelp, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { isSafeInternalHref } from '../../lib/client/explainApi'
import {
  SIMULATION_PAGE_BASE,
  isActiveSimulationStatus,
  isSimulationRunId,
  readSimulationMutationError,
} from '../../lib/client/simulation/api'
import {
  describeSimulationError,
  describeSimulationRunError,
  isSimulationNotFound,
  readSimulationFidelity,
  simulationCoverageLabel,
  simulationKindLabel,
  translateSimulationKey,
} from '../../lib/client/simulation/format'
import { useSimulationMutations, useSimulationRun } from '../../lib/client/simulation/hooks'
import type { SimulationDecisionView, SimulationRunDetail } from '../../lib/client/simulation/types'
import { formatCount, formatXrayDateTime } from '../../lib/client/xray/format'
import { SimulationGroupSection } from './SimulationResultGroups'
import { SimulationStatusBadge } from './SimulationStatusBadge'

export const SIMULATION_RUN_CONTEXT_ID = 'insights-simulation:run'

type DecisionPresentation = { Icon: LucideIcon; labelKey: string; variant: StatusBadgeVariant }

function decisionPresentation(decision: SimulationDecisionView): DecisionPresentation {
  if (decision.decision === 'discarded') return { Icon: Ban, labelKey: 'insights.simulation.ui.decisions.discarded', variant: 'neutral' }
  if (decision.verified === true) return { Icon: CheckCircle2, labelKey: 'insights.simulation.ui.decisions.appliedVerified', variant: 'success' }
  if (decision.verified === false) return { Icon: TriangleAlert, labelKey: 'insights.simulation.ui.decisions.appliedDiffers', variant: 'warning' }
  return { Icon: CircleHelp, labelKey: 'insights.simulation.ui.decisions.appliedUnverified', variant: 'neutral' }
}

function RunHeader({ run }: { run: SimulationRunDetail }) {
  const t = useT()
  const locale = useLocale()
  const from = formatXrayDateTime(run.windowFrom, locale) ?? run.windowFrom
  const to = formatXrayDateTime(run.windowTo, locale) ?? run.windowTo
  const requested = formatXrayDateTime(run.createdAt, locale)
  const started = formatXrayDateTime(run.startedAt, locale)
  const completed = formatXrayDateTime(run.completedAt, locale)
  const expires = formatXrayDateTime(run.expiresAt, locale)
  return (
    <div className="space-y-3">
      <PageHeader
        title={simulationKindLabel(run.kind, run.kindLabelKey, t)}
        description={t('insights.simulation.ui.run.window', { from, to })}
        actions={(
          <Button asChild variant="outline">
            <Link href={SIMULATION_PAGE_BASE}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('insights.simulation.ui.actions.backToList')}
            </Link>
          </Button>
        )}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground" data-testid="simulation-run-meta">
        <SimulationStatusBadge status={run.status} />
        {requested ? <span>{t('insights.simulation.ui.run.requested', { at: requested })}</span> : null}
        {started ? <span>{t('insights.simulation.ui.run.started', { at: started })}</span> : null}
        {completed ? <span>{t('insights.simulation.ui.run.completed', { at: completed })}</span> : null}
        {expires ? <span>{t('insights.simulation.ui.run.expires', { at: expires })}</span> : null}
      </div>
    </div>
  )
}

function FidelityNote({ fidelity }: { fidelity: string | null }) {
  const t = useT()
  const value = readSimulationFidelity(fidelity)
  if (!value) return null
  return (
    <p className="flex items-start gap-2 text-sm" data-testid="simulation-fidelity" data-fidelity={value}>
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        <span className="font-medium">{t('insights.simulation.ui.run.fidelityLabel', { fidelity: t(`insights.simulation.fidelity.${value}`) })}</span>
        {' '}
        <span className="text-muted-foreground">{t(`insights.simulation.ui.fidelity.${value}`)}</span>
      </span>
    </p>
  )
}

function CoverageList({ coverage }: { coverage: Record<string, number> | null }) {
  const t = useT()
  const locale = useLocale()
  const entries = Object.entries(coverage ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
  if (entries.length === 0) return null
  return (
    <section className="space-y-2" data-testid="simulation-coverage">
      <h2 className="text-base font-semibold">{t('insights.simulation.ui.coverage.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('insights.simulation.ui.coverage.description')}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-3 border-b py-1" data-coverage={key}>
            <dt className="text-muted-foreground">{simulationCoverageLabel(key, t)}</dt>
            <dd className="font-medium tabular-nums">{formatCount(value, locale)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function CaveatList({ caveats }: { caveats: readonly string[] }) {
  const t = useT()
  if (caveats.length === 0) return null
  return (
    <section className="space-y-2" data-testid="simulation-caveats">
      <h2 className="text-base font-semibold">{t('insights.simulation.ui.caveats.title')}</h2>
      <ul className="space-y-1">
        {caveats.map((caveat) => (
          <li key={caveat} className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{translateSimulationKey(caveat, t)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

type DecisionSectionProps = {
  run: SimulationRunDetail
  busy: boolean
  onDiscard: () => void
}

function DecisionSection({ run, busy, onDiscard }: DecisionSectionProps) {
  const t = useT()
  const locale = useLocale()
  const applyHref = isSafeInternalHref(run.applyHref) ? run.applyHref : null
  const discarded = run.decisions.some((decision) => decision.decision === 'discarded')
  const differs = run.decisions.some((decision) => decision.decision === 'applied' && decision.verified === false)
  if (!run.canDecide && run.decisions.length === 0) return null
  return (
    <section className="space-y-3" data-testid="simulation-decisions">
      <h2 className="text-base font-semibold">{t('insights.simulation.ui.decisions.title')}</h2>
      {run.decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('insights.simulation.ui.decisions.none')}</p>
      ) : (
        <ul className="space-y-2">
          {run.decisions.map((decision) => {
            const { Icon, labelKey, variant } = decisionPresentation(decision)
            const at = formatXrayDateTime(decision.createdAt, locale)
            return (
              <li key={`${decision.decision}:${decision.createdAt}`} className="flex flex-wrap items-center gap-2 text-sm" data-testid="simulation-decision" data-decision={decision.decision}>
                <StatusBadge variant={variant}>
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-3" aria-hidden="true" />
                    {t(labelKey)}
                  </span>
                </StatusBadge>
                {at ? <span className="text-muted-foreground">{at}</span> : null}
              </li>
            )
          })}
        </ul>
      )}
      {differs ? <p className="text-sm text-muted-foreground">{t('insights.simulation.ui.decisions.differsHelp')}</p> : null}
      {run.canDecide && (applyHref || !discarded) ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {applyHref ? (
              <Button asChild>
                <Link href={applyHref} data-testid="simulation-apply">{t('insights.simulation.ui.actions.apply')}</Link>
              </Button>
            ) : null}
            {!discarded ? (
              <Button type="button" variant="outline" onClick={onDiscard} disabled={busy} data-testid="simulation-discard">
                {t('insights.simulation.ui.actions.discard')}
              </Button>
            ) : null}
          </div>
          {applyHref ? <p className="text-xs text-muted-foreground">{t('insights.simulation.ui.decisions.applyHelp')}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

function RunResult({ run }: { run: SimulationRunDetail }) {
  const t = useT()
  const locale = useLocale()
  const result = run.result
  if (!result) return null
  return (
    <section className="space-y-4" data-testid="simulation-result">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('insights.simulation.ui.result.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('insights.simulation.ui.result.privacyNote', { k: formatCount(result.k, locale) })}</p>
      </div>
      {result.truncated ? (
        <Alert status="warning" size="default" data-testid="simulation-truncated">
          <AlertTitle>{t('insights.simulation.ui.run.truncatedTitle')}</AlertTitle>
          <AlertDescription>{t('insights.simulation.ui.run.truncatedDescription')}</AlertDescription>
        </Alert>
      ) : null}
      {result.groups.length === 0 ? (
        <EmptyState variant="subtle" title={t('insights.simulation.ui.result.emptyTitle')} description={t('insights.simulation.ui.result.emptyDescription')} />
      ) : (
        result.groups.map((group) => <SimulationGroupSection key={group.key} kind={run.kind} group={group} k={result.k} />)
      )}
    </section>
  )
}

/**
 * The result of one of the viewer's own runs: status (text + icon), window and dates; progress
 * with a guarded Cancel while queued or running (refreshed every 2 s); for a completed run the
 * fidelity, partial-result notice, one section per event with k-suppressed counts and live
 * samples, coverage, caveats and the decisions with "Apply in the editor" / guarded "Discard".
 */
export function SimulationRunPageClient({ runId }: { runId: string }) {
  const t = useT()
  const validId = isSimulationRunId(runId)
  const run = useSimulationRun(validId ? runId : null, { poll: true })
  const { cancelRun, decideRun } = useSimulationMutations(SIMULATION_RUN_CONTEXT_ID)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [busy, setBusy] = React.useState<'cancel' | 'discard' | null>(null)
  const reload = run.reload

  const handleCancel = React.useCallback(async () => {
    if (busy) return
    setBusy('cancel')
    try {
      await cancelRun(runId)
      flash(t('insights.simulation.ui.run.cancelledFlash'), 'success')
    } catch (error) {
      const parsed = readSimulationMutationError(error)
      flash(describeSimulationError(parsed, t, 'insights.simulation.ui.errors.cancelFailed'), parsed.code === 'run_not_active' ? 'info' : 'error')
    } finally {
      setBusy(null)
      reload()
    }
  }, [busy, cancelRun, reload, runId, t])

  const handleDiscard = React.useCallback(async () => {
    if (busy) return
    const confirmed = await confirm({
      title: t('insights.simulation.ui.decisions.discardConfirmTitle'),
      text: t('insights.simulation.ui.decisions.discardConfirmText'),
      confirmText: t('insights.simulation.ui.actions.discard'),
    })
    if (!confirmed) return
    setBusy('discard')
    try {
      await decideRun(runId, 'discarded')
      flash(t('insights.simulation.ui.decisions.discardedFlash'), 'success')
    } catch (error) {
      const parsed = readSimulationMutationError(error)
      if (parsed.code !== 'decision_exists') flash(describeSimulationError(parsed, t, 'insights.simulation.ui.errors.decisionFailed'), 'error')
    } finally {
      setBusy(null)
      reload()
    }
  }, [busy, confirm, decideRun, reload, runId, t])

  if (!validId || (!run.data && isSimulationNotFound(run.error))) {
    return (
      <RecordNotFoundState
        label={t('insights.simulation.errors.run_not_found')}
        description={t('insights.simulation.ui.run.notFoundDescription')}
        backHref={SIMULATION_PAGE_BASE}
        backLabel={t('insights.simulation.ui.actions.backToList')}
      />
    )
  }
  if (!run.data && run.error) {
    return (
      <ErrorMessage
        label={describeSimulationError(run.error, t)}
        action={(
          <Button type="button" size="sm" variant="outline" onClick={reload}>
            {t('insights.simulation.ui.actions.retry')}
          </Button>
        )}
      />
    )
  }
  if (!run.data) return <LoadingMessage label={t('insights.simulation.ui.loadingRun')} />

  const detail = run.data
  const active = isActiveSimulationStatus(detail.status)
  const runError = describeSimulationRunError(detail.errorCode, t)
  return (
    <div className="space-y-6" data-testid="simulation-run-page" data-status={detail.status}>
      {ConfirmDialogElement}
      <RunHeader run={detail} />
      {run.error ? (
        <ErrorMessage
          label={describeSimulationError(run.error, t)}
          action={(
            <Button type="button" size="sm" variant="outline" onClick={reload}>
              {t('insights.simulation.ui.actions.retry')}
            </Button>
          )}
        />
      ) : null}
      {active ? (
        <Alert
          status="information"
          size="default"
          data-testid="simulation-progress"
          footer={(
            <Button type="button" size="sm" variant="outline" onClick={() => { void handleCancel() }} disabled={busy !== null} data-testid="simulation-cancel">
              {t('insights.simulation.ui.actions.cancel')}
            </Button>
          )}
        >
          <AlertTitle>{t('insights.simulation.ui.run.progressTitle')}</AlertTitle>
          <AlertDescription>
            <span aria-live="polite">{t(detail.status === 'queued' ? 'insights.simulation.ui.run.queued' : 'insights.simulation.ui.run.running')}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'failed' ? (
        <Alert status="error" size="default" data-testid="simulation-failed">
          <AlertTitle>{t('insights.simulation.ui.run.failedTitle')}</AlertTitle>
          <AlertDescription>{runError ?? t('insights.simulation.errorCodes.internal')}</AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'cancelled' ? (
        <Alert status="warning" size="default" data-testid="simulation-cancelled">
          <AlertTitle>{t('insights.simulation.ui.run.cancelledTitle')}</AlertTitle>
          <AlertDescription>{runError ?? t('insights.simulation.ui.run.cancelledDescription')}</AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'completed' ? <FidelityNote fidelity={detail.fidelity} /> : null}
      <RunResult run={detail} />
      {detail.status === 'completed' ? <CoverageList coverage={detail.coverage} /> : null}
      <CaveatList caveats={detail.caveats} />
      <DecisionSection run={detail} busy={busy !== null} onDiscard={() => { void handleDiscard() }} />
    </div>
  )
}
