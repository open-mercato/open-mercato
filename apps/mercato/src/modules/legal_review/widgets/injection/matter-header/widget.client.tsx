"use client"

import * as React from 'react'
import { Globe, Scale } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
 * document has no matter or the viewer may not read matters. Read-only — it
 * performs no writes, so it needs no guarded mutation or optimistic lock.
 */
export default function LegalMatterHeaderWidget({
  context,
}: InjectionWidgetComponentProps<LegalMatterHeaderContext, Record<string, unknown>>) {
  const t = useT()
  const locale = useLocale()
  const documentId = readDocumentIdFromContext(context)
  const [state, setState] = React.useState<LoadState>({ status: 'idle' })

  React.useEffect(() => {
    if (!documentId) {
      setState({ status: 'ready', matter: null })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
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
  }, [documentId])

  if (state.status === 'loading') {
    return <LoadingMessage label={t('legal_review.header.loading', 'Loading legal matter…')} />
  }
  if (state.status !== 'ready' || !state.matter) return null

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
