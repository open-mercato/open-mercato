import * as React from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { ErrorMessage, LoadingMessage, RecordNotFoundState, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { buildExplainPageHref, fetchLogExplanation, isAbortError } from '../lib/client/explainApi'
import { describeActor, describePrincipal, formatExplainDateTime } from '../lib/client/format'
import type { ExplainLogResponse } from '../lib/client/types'
import { CauseChip } from './CauseChip'
import { ConfidenceBadge } from './ConfidenceBadge'

type LogExplanationState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; body: ExplainLogResponse }

export function useLogExplanation(logId: string | null): { state: LogExplanationState; retry: () => void } {
  const [state, setState] = React.useState<LogExplanationState>({ status: 'loading' })
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    if (!logId) {
      setState({ status: 'not_found' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchLogExplanation(logId, controller.signal)
      .then((outcome) => {
        if (controller.signal.aborted) return
        if (outcome.status === 'ok') setState({ status: 'ready', body: outcome.body })
        else if (outcome.status === 'not_found') setState({ status: 'not_found' })
        else if (outcome.status === 'forbidden') setState({ status: 'forbidden' })
        else setState({ status: 'error' })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setState({ status: 'error' })
      })
    return () => {
      controller.abort()
    }
  }, [logId, attempt])
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

export type LogCausePanelProps = {
  logId: string
  className?: string
}

export function LogCausePanel({ logId, className }: LogCausePanelProps) {
  const t = useT()
  const locale = useLocale()
  const { state, retry } = useLogExplanation(logId)

  if (state.status === 'loading') return <LoadingMessage className={className} label={t('insights.why.loading')} />
  if (state.status === 'not_found') {
    return (
      <RecordNotFoundState
        className={cn('min-h-0 px-0 py-4', className)}
        label={t('insights.why.log.notFound')}
      />
    )
  }
  if (state.status === 'forbidden') {
    return (
      <TabEmptyState
        className={className}
        title={t('insights.why.forbidden.title')}
        description={t('insights.why.forbidden.description')}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorMessage
        className={className}
        label={t('insights.why.error')}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t('insights.why.retry')}
          </Button>
        )}
      />
    )
  }

  const body = state.body
  const causeNote = body.cause.legacy || body.cause.derivedFromActor
    ? t(body.cause.labelKey ?? `insights.explain.causeKinds.${body.cause.kind}`)
    : null
  const recordHref = body.resourceKind && body.resourceId
    ? buildExplainPageHref({ resourceKind: body.resourceKind, resourceId: body.resourceId })
    : null

  return (
    <div className={cn('space-y-3 rounded-lg border border-border p-3', className)} data-testid="insights-log-cause">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t('insights.why.log.title')}</h4>
        <ConfidenceBadge confidence={body.confidence} />
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label={t('insights.why.chain.details.cause')}>
          <div className="space-y-1">
            <CauseChip cause={body.cause} />
            {causeNote ? <p className="text-xs text-muted-foreground">{causeNote}</p> : null}
          </div>
        </Row>
        {body.origin ? (
          <Row label={t('insights.why.chain.details.origin')}>
            <CauseChip cause={body.origin} />
          </Row>
        ) : null}
        <Row label={t('insights.why.log.actor')}>{describeActor(body.actor, t)}</Row>
        {body.onBehalfOf ? (
          <Row label={t('insights.why.chain.details.onBehalfOf')}>{describePrincipal(body.onBehalfOf, t)}</Row>
        ) : null}
        <Row label={t('insights.why.log.at')}>
          <time dateTime={body.at}>{formatExplainDateTime(body.at, locale) ?? body.at}</time>
        </Row>
        {body.state !== 'done' ? (
          <Row label={t('insights.why.chain.details.state')}>{t(`insights.explain.states.${body.state}`)}</Row>
        ) : null}
        {body.causedBy ? (
          <Row label={t('insights.why.chain.details.triggeredBy')}>
            {body.causedBy.available
              ? t('insights.why.chain.details.causedBy')
              : t('insights.why.chain.details.causedByUnavailable')}
          </Row>
        ) : null}
      </dl>
      {recordHref ? (
        <LinkButton asChild size="sm" underline="always">
          <Link href={recordHref}>{t('insights.why.log.openRecord')}</Link>
        </LinkButton>
      ) : null}
    </div>
  )
}

export default LogCausePanel
