import * as React from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  ErrorMessage,
  LoadingMessage,
  RecordNotFoundState,
  TabEmptyState,
} from '@open-mercato/ui/backend/detail'
import { describeFieldLabel, formatExplainDateTime } from '../lib/client/format'
import { isExplainFieldResponse, type ExplainOverviewResponse } from '../lib/client/types'
import { useExplanation } from '../lib/client/useExplanation'
import { ConfidenceBadge } from './ConfidenceBadge'
import { VerdictBadge } from './VerdictBadge'
import { WhyChain } from './WhyChain'

export type WhyExplanationProps = {
  resourceKind: string
  resourceId: string
  field: string | null
  itemId?: string | null
  onSelectField?: (field: string | null) => void
  allowOverview?: boolean
  className?: string
}

function ExplanationStatus({
  status,
  onRetry,
}: {
  status: 'loading' | 'not_found' | 'forbidden' | 'error'
  onRetry: () => void
}) {
  const t = useT()
  if (status === 'loading') return <LoadingMessage label={t('insights.why.loading')} />
  if (status === 'forbidden') {
    return (
      <TabEmptyState
        title={t('insights.why.forbidden.title')}
        description={t('insights.why.forbidden.description')}
      />
    )
  }
  if (status === 'not_found') {
    return (
      <RecordNotFoundState
        className="min-h-0 px-0 py-6"
        label={t('insights.why.notFound.title')}
        description={t('insights.why.notFound.description')}
      />
    )
  }
  return (
    <ErrorMessage
      label={t('insights.why.error')}
      action={(
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('insights.why.retry')}
        </Button>
      )}
    />
  )
}

function OverviewList({
  overview,
  onSelectField,
}: {
  overview: ExplainOverviewResponse
  onSelectField?: (field: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const noHistory = overview.coverage?.noHistory ?? null
  if (overview.fields.length === 0) {
    return (
      <TabEmptyState
        title={t('insights.why.overview.empty.title')}
        description={noHistory ? t(noHistory.reasonKey) : t('insights.why.overview.empty.description')}
      />
    )
  }
  return (
    <section className="space-y-3">
      {noHistory ? <p className="text-sm text-muted-foreground">{t(noHistory.reasonKey)}</p> : null}
      <ul className="space-y-2">
        {overview.fields.map((entry) => {
          const label = describeFieldLabel(entry.field, entry.labelKey, t)
          const lastChange = entry.lastChangeAt ? formatExplainDateTime(entry.lastChangeAt, locale) : null
          return (
            <li key={entry.field}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full items-start justify-between gap-3 whitespace-normal px-3 py-3 text-left"
                aria-label={t('insights.why.overview.open', { field: label })}
                onClick={() => onSelectField?.(entry.field)}
                disabled={!onSelectField}
                data-field={entry.field}
              >
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block break-words text-sm font-medium text-foreground">{label}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <VerdictBadge verdict={entry.verdict} />
                    <ConfidenceBadge confidence={entry.confidence} />
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {lastChange
                      ? t('insights.why.overview.lastChange', { at: lastChange })
                      : t('insights.why.overview.noChange')}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </ul>
      {overview.coverage?.legacyRows > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('insights.explain.hints.legacyRows', { count: overview.coverage.legacyRows })}
        </p>
      ) : null}
      {overview.coverage?.truncated ? (
        <p className="text-xs text-muted-foreground">{t('insights.explain.hints.truncated')}</p>
      ) : null}
    </section>
  )
}

export function WhyExplanation({
  resourceKind,
  resourceId,
  field,
  itemId = null,
  onSelectField,
  allowOverview = true,
  className,
}: WhyExplanationProps) {
  const t = useT()
  const request = React.useMemo(
    () => ({ resourceKind, resourceId, field: field ?? null, itemId: field ? itemId : null }),
    [resourceKind, resourceId, field, itemId],
  )
  const { state, retry, olderPages, olderStatus, loadOlder } = useExplanation(request)
  const headingRef = React.useRef<HTMLHeadingElement | null>(null)
  const previousFieldRef = React.useRef(field)

  React.useEffect(() => {
    if (previousFieldRef.current === field) return
    previousFieldRef.current = field
    headingRef.current?.focus()
  }, [field])

  const fieldBody = state.status === 'ready' && isExplainFieldResponse(state.body) ? state.body : null
  const overviewBody = state.status === 'ready' && !isExplainFieldResponse(state.body) ? state.body : null
  const shapeMismatch = state.status === 'ready' && (field ? !fieldBody : !overviewBody)

  return (
    <div className={cn('space-y-4', className)} data-testid="insights-why-explanation">
      {field && allowOverview && onSelectField ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onSelectField(null)}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('insights.why.field.back')}
        </Button>
      ) : null}
      {field ? (
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
          {fieldBody ? describeFieldLabel(fieldBody.field, fieldBody.labelKey, t) : describeFieldLabel(field, null, t)}
        </h3>
      ) : (
        <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
          {t('insights.why.overview.title')}
        </h3>
      )}
      {state.status !== 'ready' ? (
        <ExplanationStatus status={state.status} onRetry={retry} />
      ) : shapeMismatch ? (
        <ExplanationStatus status="error" onRetry={retry} />
      ) : fieldBody ? (
        <WhyChain explanation={fieldBody} olderPages={olderPages} olderStatus={olderStatus} onLoadOlder={loadOlder} />
      ) : overviewBody ? (
        <OverviewList overview={overviewBody} onSelectField={onSelectField ?? undefined} />
      ) : null}
    </div>
  )
}

export default WhyExplanation
