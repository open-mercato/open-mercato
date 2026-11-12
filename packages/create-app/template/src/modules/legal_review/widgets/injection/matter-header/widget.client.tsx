"use client"

import * as React from 'react'
import { CalendarClock, FileSignature, Globe, Scale, ScrollText } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import type { LegalMatterItem } from '../../../data/validators'
import { buildLegalMatterSteps } from '../../../lib/stages'
import {
  buildMatterListPath,
  buildStageStatusLine,
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
    <div className="flex items-center gap-2">
      <Avatar label={display} size="sm" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{caption}</span>
        <span className="text-sm font-medium text-foreground">{display}</span>
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
  const steps: StepIndicatorStep[] = buildLegalMatterSteps(matter.stage).map((step) => ({
    id: step.stage,
    label: t(`legal_review.stage.${step.stage}`, step.stage),
    status: step.state,
  }))
  const statusLine = buildStageStatusLine(matter, t, locale)

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      aria-label={t('legal_review.header.ariaLabel', 'Legal matter')}
      data-testid="legal-review-matter-header"
    >
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Scale className="size-3.5" aria-hidden="true" />
          <span className="font-mono">{matter.reference}</span>
        </span>
        <h2 className="text-lg font-semibold text-foreground">{matter.counterparty}</h2>
        {matter.purpose ? <p className="text-sm text-muted-foreground">{matter.purpose}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {matter.jurisdiction ? (
          <Tag variant="neutral" leading={<Globe className="size-3.5" aria-hidden="true" />}>
            {matter.jurisdiction}
          </Tag>
        ) : null}
        <Tag variant="neutral" leading={<ScrollText className="size-3.5" aria-hidden="true" />}>
          {t(`legal_review.agreementType.${matter.agreementType}`, matter.agreementType)}
        </Tag>
        <Tag variant="neutral" leading={<FileSignature className="size-3.5" aria-hidden="true" />}>
          {t(`legal_review.paper.${matter.paper}`, matter.paper)}
        </Tag>
      </div>

      <div className="flex flex-wrap gap-6">
        <PersonLine caption={t('legal_review.header.askedBy', 'Asked by')} label={matter.requestedByLabel} />
        <PersonLine caption={t('legal_review.header.assignee', 'Assignee')} label={matter.assigneeLabel} />
      </div>

      <div className="flex flex-col gap-2">
        <StepIndicator steps={steps} aria-label={t('legal_review.header.stages', 'Matter stages')} />
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="legal-review-stage-status">
          <CalendarClock className="size-4" aria-hidden="true" />
          {statusLine}
        </p>
      </div>
    </section>
  )
}
