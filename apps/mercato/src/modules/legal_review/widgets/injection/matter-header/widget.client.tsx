"use client"

import * as React from 'react'
import { Globe, Scale, Sparkles } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { LegalMatterItem } from '../../../data/validators'
import { buildLegalMatterSteps, type LegalMatterStepState } from '../../../lib/stages'
import {
  buildMatterListPath,
  buildStageStatusLine,
  formatJurisdiction,
  isMatterOverdue,
  pickMatterFromListResponse,
  readDocumentIdFromContext,
  type LegalMatterHeaderContext,
} from '../../../lib/matterHeader'
import { StartReviewDialog } from './StartReviewDialog'

const MANAGE_FEATURE = 'legal_review.matters.manage'

type ManageAccess = { canManage: boolean; userId: string | null }

function useManageAccess(): ManageAccess {
  const [access, setAccess] = React.useState<ManageAccess>({ canManage: false, userId: null })
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ granted?: unknown[]; userId?: unknown }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: [MANAGE_FEATURE] }),
    })
      .then((call) => {
        if (cancelled || !call.ok) return
        const granted = Array.isArray(call.result?.granted) ? call.result.granted.map((entry) => String(entry)) : []
        const userId = typeof call.result?.userId === 'string' ? call.result.userId : null
        setAccess({ canManage: hasAllFeatures([MANAGE_FEATURE], granted), userId })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return access
}

function StartReviewBar({ documentId, onStarted }: { documentId: string; onStarted: () => void }) {
  const t = useT()
  const access = useManageAccess()
  const [open, setOpen] = React.useState(false)
  const contextId = `legal-review-start:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId, blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation') })

  const handleSubmit = React.useCallback(async (payload: Record<string, unknown>) => {
    try {
      await runMutation({
        operation: () => apiCallOrThrow<unknown>(
          '/api/legal_review/matters',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
          { errorMessage: t('legal_review.start.error', 'Could not start the legal review') },
        ),
        context: { formId: contextId, resourceKind: 'legal_review.matter', resourceId: documentId, retryLastMutation },
        mutationPayload: payload,
      })
      flash(t('legal_review.start.success', 'Review started — results in about a minute'), 'success')
      onStarted()
      return true
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('legal_review.start.error', 'Could not start the legal review')
      flash(message, 'error')
      return false
    }
  }, [contextId, documentId, onStarted, retryLastMutation, runMutation, t])

  if (!access.canManage) return null

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-4 py-3"
      data-testid="legal-review-start-bar"
    >
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Scale className="size-4" aria-hidden="true" />
        {t('legal_review.start.prompt', 'No legal review for this document yet.')}
      </span>
      <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="legal-review-start-button">
        {t('legal_review.start.button', 'Start legal review')}
      </Button>
      <StartReviewDialog
        open={open}
        documentId={documentId}
        currentUserId={access.userId}
        onOpenChange={setOpen}
        onSubmit={handleSubmit}
      />
    </section>
  )
}

const PROGRESS_POLL_MS = 4000
const PROGRESS_MAX_MS = 5 * 60 * 1000
const PROGRESS_PENDING_MS = 30 * 1000
const ACTIVE_STATUSES = new Set(['RUNNING', 'PAUSED', 'WAITING', 'WAITING_FOR_ACTIVITIES'])
const AGENT_STEPS = new Set(['ai_review', 'start'])

type ReviewProgress = 'idle' | 'running' | 'failed'

function readLatestInstance(payload: unknown): { status: string; currentStepId: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  const first = Array.isArray(data) ? data[0] : null
  if (!first || typeof first !== 'object') return null
  const record = first as Record<string, unknown>
  return {
    status: typeof record.status === 'string' ? record.status : '',
    currentStepId: typeof record.currentStepId === 'string' ? record.currentStepId : '',
  }
}

function useReviewProgress(documentId: string | null): ReviewProgress {
  const [progress, setProgress] = React.useState<ReviewProgress>('idle')
  const seenRunningRef = React.useRef(false)
  const reloadedRef = React.useRef(false)
  React.useEffect(() => {
    if (!documentId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()
    const path = `/api/workflows/instances?correlationKey=${encodeURIComponent(`legal_review:${documentId}`)}&limit=1&pageSize=1`
    const poll = async () => {
      if (stopped) return
      let keepPolling = false
      try {
        const call = await apiCall<unknown>(path, { headers: { 'x-om-forbidden-redirect': '0' } })
        if (stopped) return
        const instance = call.ok ? readLatestInstance(call.result) : null
        if (instance && ACTIVE_STATUSES.has(instance.status) && AGENT_STEPS.has(instance.currentStepId)) {
          seenRunningRef.current = true
          setProgress('running')
          keepPolling = true
        } else if (instance && seenRunningRef.current && instance.currentStepId === 'manual_review') {
          setProgress('failed')
        } else if (instance && seenRunningRef.current) {
          setProgress('idle')
          if (!reloadedRef.current) {
            reloadedRef.current = true
            window.location.reload()
          }
        } else {
          setProgress('idle')
          keepPolling = !instance && call.ok && Date.now() - startedAt < PROGRESS_PENDING_MS
        }
      } catch {
        if (!stopped) setProgress('idle')
      }
      if (keepPolling && !stopped && Date.now() - startedAt < PROGRESS_MAX_MS) {
        timer = setTimeout(() => void poll(), PROGRESS_POLL_MS)
      } else if (keepPolling) {
        setProgress('idle')
      }
    }
    void poll()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [documentId])
  return progress
}

function ReviewProgressBar({ progress }: { progress: ReviewProgress }) {
  const t = useT()
  return (
    <div aria-live="polite" className="lg:col-span-2">
      {progress === 'running' ? (
        <div
          className="flex items-center gap-2 rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-sm text-status-info-text"
          data-testid="legal-review-progress"
        >
          <Spinner size="sm" />
          <Sparkles className="size-4" aria-hidden="true" />
          <span>{t('legal_review.progress.running', 'Review agent is analysing the document…')}</span>
        </div>
      ) : null}
      {progress === 'failed' ? (
        <p className="text-sm text-status-warning-text" data-testid="legal-review-progress-failed">
          {t('legal_review.progress.failed', 'Automatic review failed — manual review task created')}
        </p>
      ) : null}
    </div>
  )
}

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; matter: LegalMatterItem | null }

function PersonLine({ caption, label }: { caption: string; label: string | null }) {
  const t = useT()
  const display = label ?? t('legal_review.header.unassigned', 'Unassigned')
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar label={display} size="md" />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{caption}</span>
        <span className="truncate text-sm font-medium text-foreground">{display}</span>
      </div>
    </div>
  )
}

/**
 * Legal matter header for the document page (`detail:documents.document:header`).
 *
 * Loads the matter linked to `context.documentId`; renders nothing when the
 * viewer may not read matters. When the document has no matter yet and the
 * viewer may manage matters, it offers "Start legal review" instead — the
 * create goes through a guarded mutation and the matter-created subscriber
 * starts the NDA review run.
 */
export default function LegalMatterHeaderWidget({
  context,
}: InjectionWidgetComponentProps<LegalMatterHeaderContext, Record<string, unknown>>) {
  const t = useT()
  const locale = useLocale()
  const documentId = readDocumentIdFromContext(context)
  const [state, setState] = React.useState<LoadState>({ status: 'idle' })
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])
  const hasMatter = state.status === 'ready' && state.matter !== null
  const progress = useReviewProgress(hasMatter ? documentId : null)

  React.useEffect(() => {
    if (!documentId) {
      setState({ status: 'ready', matter: null })
      return
    }
    let cancelled = false
    setState((current) => (current.status === 'ready' && reloadToken > 0 ? current : { status: 'loading' }))
    apiCall<unknown>(buildMatterListPath(documentId), { headers: { 'x-om-forbidden-redirect': '0' } })
      .then((call) => {
        if (cancelled) return
        setState({ status: 'ready', matter: call.ok ? pickMatterFromListResponse(call.result) : null })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'ready', matter: null })
      })
    return () => {
      cancelled = true
    }
  }, [documentId, reloadToken])

  if (state.status === 'loading') {
    return <LoadingMessage label={t('legal_review.header.loading', 'Loading legal matter…')} />
  }
  if (state.status !== 'ready') return null
  if (!state.matter) {
    return documentId ? <StartReviewBar documentId={documentId} onStarted={reload} /> : null
  }

  const matter = state.matter
  const steps = buildLegalMatterSteps(matter.stage)
  const currentStep = steps.find((step) => step.state === 'current') ?? steps[0]
  const statusLine = buildStageStatusLine(matter, t, locale)
  const overdue = isMatterOverdue(matter)
  const meta = [
    formatJurisdiction(matter.jurisdiction, locale),
    t(`legal_review.agreementType.${matter.agreementType}`, matter.agreementType),
    t(`legal_review.paper.${matter.paper}`, matter.paper),
  ].filter((value): value is string => Boolean(value))

  return (
    <section
      className="grid items-start gap-x-10 gap-y-6 border-b border-border pb-6 lg:grid-cols-2"
      aria-label={t('legal_review.header.ariaLabel', 'Legal matter')}
      data-testid="legal-review-matter-header"
    >
      <ReviewProgressBar progress={progress} />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Scale className="size-3.5" aria-hidden="true" />
            <span className="font-mono">{matter.reference}</span>
          </span>
          <h2 className="truncate text-2xl font-semibold tracking-tight text-foreground">{matter.counterparty}</h2>
          {matter.purpose ? <p className="text-base text-muted-foreground">{matter.purpose}</p> : null}
          {meta.length > 0 ? (
            <p className="inline-flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground" data-testid="legal-review-matter-meta">
              {matter.jurisdiction ? <Globe className="size-4" aria-hidden="true" /> : null}
              {meta.map((item, index) => (
                <React.Fragment key={item}>
                  {index > 0 ? <span aria-hidden="true">·</span> : null}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <PersonLine caption={t('legal_review.header.askedBy', 'Asked by')} label={matter.requestedByLabel} />
          <PersonLine caption={t('legal_review.header.assignee', 'Assignee')} label={matter.assigneeLabel} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:pt-6">
        <p className="text-sm" data-testid="legal-review-stage-status">
          <span className="font-semibold text-foreground">
            {t(`legal_review.stage.${currentStep.stage}`, currentStep.stage)}
          </span>
          <span className={overdue ? 'text-status-error-text' : 'text-muted-foreground'}>
            {' · '}
            {statusLine}
          </span>
        </p>
        <ol className="grid grid-cols-4 gap-2" aria-label={t('legal_review.header.stages', 'Matter stages')}>
          {steps.map((step) => (
            <li
              key={step.stage}
              className="flex min-w-0 flex-col gap-2"
              aria-current={step.state === 'current' ? 'step' : undefined}
              data-state={step.state}
            >
              <span className={`h-1.5 rounded-full ${STEP_BAR_CLASS[step.state]}`} aria-hidden="true" />
              <span className={`truncate text-xs ${STEP_LABEL_CLASS[step.state]}`}>
                {t(`legal_review.stage.${step.stage}`, step.stage)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

const STEP_BAR_CLASS: Record<LegalMatterStepState, string> = {
  complete: 'bg-primary',
  current: 'bg-primary/50',
  pending: 'bg-muted',
}

const STEP_LABEL_CLASS: Record<LegalMatterStepState, string> = {
  complete: 'text-muted-foreground',
  current: 'font-medium text-foreground',
  pending: 'text-muted-foreground',
}
