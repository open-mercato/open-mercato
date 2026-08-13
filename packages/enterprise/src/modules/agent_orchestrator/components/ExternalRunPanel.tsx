"use client"

import * as React from 'react'
import { Download, Globe, Timer, PhoneCall } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatDurationMs } from './types'
import {
  EXTERNAL_RUN_STATUS_VARIANT,
  deriveExternalRunClock,
  formatParkedDuration,
  mapExternalRunState,
  type ExternalRunStateView,
} from './externalRunView'

/**
 * The EXTERNAL half of a run, in the trace inspector (tracker task 3.4).
 *
 * Before this card, an external run was illegible: it rendered as an ordinary
 * run with an empty output, a duration tile holding the provider's call length
 * and nothing at all about the twenty-eight minutes it spent parked waiting for
 * someone to pick up a phone. Everything that explains it lives on
 * `agent_external_runs`, which nothing exposed.
 *
 * The card answers four questions and nothing else:
 *
 *   WHO ran it            the connector id, and whether its package is even
 *                         deployed in the process serving this page
 *   WHICH run             the provider's own id, which is how an operator finds
 *                         the same conversation in the provider's dashboard
 *   HOW LONG              the two clocks, which differ by orders of magnitude
 *   WHERE IS THE AUDIO    at the provider — said in words, with a control that
 *                         streams it through without keeping a copy
 *
 * What it deliberately does NOT show: the destination phone number (it is on the
 * correlation row's encrypted brief and the read route does not return it) and
 * the transcript (already rendered once, as the run's output and as a
 * downloadable artifact — a second copy here would be a second thing to redact).
 */

export type ExternalRunCardProps = {
  runId: string
  /** Run-row facts the two clocks are derived from — no second fetch for them. */
  run: { createdAt: string | null; completedAt: string | null; latencyMs: number | null }
}

export function ExternalRunCard({ runId, run }: ExternalRunCardProps) {
  const t = useT()
  const locale = useLocale()
  const [state, setState] = React.useState<ExternalRunStateView | null>(null)

  React.useEffect(() => {
    let active = true
    void (async () => {
      const call = await apiCall<Record<string, unknown>>(
        `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/external`,
        undefined,
        { fallback: {} },
      )
      if (!active) return
      // A failed call maps to "no external run", exactly like a native run does.
      // The card then hides itself, which is the honest answer: this page cannot
      // say anything about an external invocation it could not read.
      setState(mapExternalRunState(call.ok ? call.result : null))
    })()
    return () => {
      active = false
    }
  }, [runId])

  const externalRun = state?.externalRun ?? null
  const connector = state?.connector ?? null
  // Nothing is rendered until there is something true to say — no skeleton and
  // no empty state, because the overwhelmingly common case is a native run that
  // should show no card at all.
  if (!externalRun) return null

  const clock = deriveExternalRunClock(run)
  // Two formatters on purpose: the park is read in minutes and hours, the
  // provider's own duration must match the header's Duration tile exactly.
  const parked = formatParkedDuration(clock.parkedMs)
  const talked = formatDurationMs(clock.talkedMs)
  const canFetchRecording = !!connector?.supportsRecording && !!externalRun.externalRunId

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">
            {t('agent_orchestrator.traces.detail.external.title')}
          </h2>
        </div>
        <StatusBadge variant={EXTERNAL_RUN_STATUS_VARIANT[externalRun.status]} dot>
          {t(`agent_orchestrator.traces.detail.external.status.${externalRun.status}`)}
        </StatusBadge>
      </div>

      <p className="text-sm text-muted-foreground">{t('agent_orchestrator.traces.detail.external.hint')}</p>

      <dl className="mt-4 grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('agent_orchestrator.traces.detail.external.connector')}</dt>
        <dd className="min-w-0 truncate font-mono text-xs text-foreground">{externalRun.connectorId}</dd>

        <dt className="text-muted-foreground">{t('agent_orchestrator.traces.detail.external.providerRunId')}</dt>
        <dd className="min-w-0 truncate font-mono text-xs text-foreground">
          {externalRun.externalRunId ?? (
            <span className="font-sans text-muted-foreground">
              {t('agent_orchestrator.traces.detail.external.providerRunIdUnknown')}
            </span>
          )}
        </dd>

        {/* The two clocks, side by side and labelled — the whole point is that
            they are different quantities, so they are never shown alone. */}
        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <Timer className="size-3.5 shrink-0" aria-hidden />
          {t('agent_orchestrator.traces.detail.external.parked')}
        </dt>
        <dd className="tabular-nums text-foreground">{parked ?? '—'}</dd>

        <dt className="flex items-center gap-1.5 text-muted-foreground">
          <PhoneCall className="size-3.5 shrink-0" aria-hidden />
          {t('agent_orchestrator.traces.detail.external.talked')}
        </dt>
        <dd className="tabular-nums text-foreground">{talked ?? '—'}</dd>

        {/* The deadline only matters while the answer can still arrive. On a
            settled row it is a date that never came, and reading it as a
            promise would be misleading. */}
        {externalRun.status === 'pending' && externalRun.expiresAt ? (
          <>
            <dt className="text-muted-foreground">{t('agent_orchestrator.traces.detail.external.deadline')}</dt>
            <dd className="text-foreground">{formatDateTime(externalRun.expiresAt, locale) ?? '—'}</dd>
          </>
        ) : null}

        {externalRun.stepId ? (
          <>
            <dt className="text-muted-foreground">{t('agent_orchestrator.traces.detail.external.parkedStep')}</dt>
            <dd className="min-w-0 truncate font-mono text-xs text-foreground">{externalRun.stepId}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('agent_orchestrator.traces.detail.external.recording')}
        </p>
        {/* THE SENTENCE THAT MATTERS. An operator who does not know where the
            recording lives cannot answer an erasure request about it, and cannot
            tell that clicking below reaches out to a third party. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {t('agent_orchestrator.traces.detail.external.recordingNote')}
        </p>
        {canFetchRecording ? (
          <a
            href={`/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/recording`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted"
          >
            <Download className="size-3.5" aria-hidden />
            {t('agent_orchestrator.traces.detail.external.recordingFetch')}
          </a>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {connector && !connector.registered
              ? t('agent_orchestrator.traces.detail.external.connectorMissing')
              : t('agent_orchestrator.traces.detail.external.recordingUnsupported')}
          </p>
        )}
      </div>
    </section>
  )
}

export type ExternalRerunDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  busy?: boolean
}

/**
 * The confirmation in front of re-running an EXTERNAL run.
 *
 * T3.3's caller audit found that `POST /runs/:id/rerun` reaches the external
 * runner like any other runtime, so the "Re-run" button placed a second real
 * phone call to a real person — and then reported HTTP 500, because the
 * suspension was unhandled. The route now refuses without an explicit
 * acknowledgement (428) and this is where the operator gives it.
 *
 * `destructive` on the confirm button, and the copy names the real-world effect
 * rather than the mechanism: "another real phone call" is what the operator is
 * actually authorising, and "starts an external run" is not.
 */
export function ExternalRerunDialog({ open, onOpenChange, onConfirm, busy = false }: ExternalRerunDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            if (!busy) onConfirm()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('agent_orchestrator.traces.detail.rerunExternal.title')}</DialogTitle>
          <DialogDescription>{t('agent_orchestrator.traces.detail.rerunExternal.body')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="ml-auto"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('agent_orchestrator.traces.detail.rerunExternal.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {t('agent_orchestrator.traces.detail.rerunExternal.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
