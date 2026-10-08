"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, EyeOff, Lightbulb, Redo2, TriangleAlert, Undo2 } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { isSafeInternalHref } from '../lib/client/explainApi'
import {
  describeActor,
  describePrincipal,
  formatCurrentValue,
  formatExplainDateTime,
  formatExplainValue,
  readTranslationKeyParam,
  toTranslateParams,
  type FormattedExplainValue,
} from '../lib/client/format'
import type {
  ExplainChainEntryView,
  ExplainFieldResponse,
  ExplainGapView,
  ExplainHintView,
  ExplainValueView,
} from '../lib/client/types'
import { CauseChip } from './CauseChip'
import { ConfidenceBadge } from './ConfidenceBadge'
import { VerdictBadge } from './VerdictBadge'

export type WhyChainOlderStatus = 'idle' | 'loading' | 'error'

export type WhyChainProps = {
  explanation: ExplainFieldResponse
  olderPages?: ExplainFieldResponse[]
  olderStatus?: WhyChainOlderStatus
  onLoadOlder?: () => void
  className?: string
}

function ValueText({ formatted }: { formatted: FormattedExplainValue }) {
  if (formatted.tone === 'redacted') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" data-value-tone="redacted">
        <EyeOff className="size-3" aria-hidden="true" />
        <span>{formatted.text}</span>
      </span>
    )
  }
  return (
    <span
      className={cn('break-words', formatted.tone === 'value' ? 'font-medium text-foreground' : 'italic text-muted-foreground')}
      data-value-tone={formatted.tone}
    >
      {formatted.text}
    </span>
  )
}

function ValueChange({ from, to }: { from: ExplainValueView | null; to: ExplainValueView | null }) {
  const t = useT()
  const locale = useLocale()
  const synthesized = from?.source === 'synthesized' || to?.source === 'synthesized'
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ValueText formatted={formatExplainValue(from, t, locale)} />
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('insights.why.chain.changedTo')}</span>
        <ValueText formatted={formatExplainValue(to, t, locale)} />
      </div>
      {synthesized ? <p className="text-xs text-muted-foreground">{t('insights.why.values.synthesized')}</p> : null}
    </div>
  )
}

function EntryStateBadge({ state }: { state: ExplainChainEntryView['state'] }) {
  const t = useT()
  if (state === 'done') return null
  const Icon = state === 'undone' ? Undo2 : Redo2
  return (
    <StatusBadge variant={state === 'undone' ? 'neutral' : 'info'} className="shrink-0">
      <Icon className="size-3" aria-hidden="true" />
      <span data-entry-state={state}>{t(`insights.explain.states.${state}`)}</span>
    </StatusBadge>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

function EntryDetails({ entry, id }: { entry: ExplainChainEntryView; id: string }) {
  const t = useT()
  const causeNote = entry.cause.legacy || entry.cause.derivedFromActor
    ? t(entry.cause.labelKey ?? `insights.explain.causeKinds.${entry.cause.kind}`)
    : null
  const frames = entry.cause.frames.length > 1 ? entry.cause.frames : []
  return (
    <dl id={id} className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
      <DetailRow label={t('insights.why.chain.details.cause')}>
        <div className="space-y-1">
          <CauseChip cause={entry.cause} />
          {causeNote ? <p className="text-xs text-muted-foreground">{causeNote}</p> : null}
        </div>
      </DetailRow>
      {frames.length > 0 ? (
        <DetailRow label={t('insights.why.chain.details.frames')}>
          <ol className="flex flex-wrap items-center gap-2">
            {frames.map((frame, index) => (
              <li key={`${frame.kind}:${frame.id ?? frame.ref ?? index}`}>
                <CauseChip cause={frame} />
              </li>
            ))}
          </ol>
        </DetailRow>
      ) : null}
      {entry.origin ? (
        <DetailRow label={t('insights.why.chain.details.origin')}>
          <CauseChip cause={entry.origin} />
        </DetailRow>
      ) : null}
      {entry.onBehalfOf ? (
        <DetailRow label={t('insights.why.chain.details.onBehalfOf')}>
          {describePrincipal(entry.onBehalfOf, t)}
        </DetailRow>
      ) : null}
      {entry.causedBy ? (
        <DetailRow label={t('insights.why.chain.details.triggeredBy')}>
          {entry.causedBy.available
            ? t('insights.why.chain.details.causedBy')
            : t('insights.why.chain.details.causedByUnavailable')}
        </DetailRow>
      ) : null}
      {entry.commandId ? (
        <DetailRow label={t('insights.why.chain.details.command')}>
          <code className="break-all font-mono text-xs">{entry.commandId}</code>
        </DetailRow>
      ) : null}
      {entry.correlationId ? (
        <DetailRow label={t('insights.why.chain.details.correlation')}>
          <code className="break-all font-mono text-xs">{entry.correlationId}</code>
        </DetailRow>
      ) : null}
      {entry.undoneBy ? (
        <DetailRow label={t('insights.why.chain.details.state')}>
          {t('insights.why.chain.details.undoneBy')}
        </DetailRow>
      ) : null}
      {entry.orderUncertain ? (
        <DetailRow label={t('insights.why.chain.details.note')}>
          {t('insights.why.chain.details.orderUncertain')}
        </DetailRow>
      ) : null}
      {entry.stale ? (
        <DetailRow label={t('insights.why.chain.details.note')}>
          {t('insights.why.chain.details.stale')}
        </DetailRow>
      ) : null}
    </dl>
  )
}

function ChainEntryItem({
  entry,
  expanded,
  onToggle,
}: {
  entry: ExplainChainEntryView
  expanded: boolean
  onToggle: (logId: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const detailsId = `why-entry-${entry.logId}-details`
  const at = formatExplainDateTime(entry.at, locale) ?? entry.at
  const actor = describeActor(entry.actor, t)
  return (
    <li
      className="rounded-lg border border-border bg-card p-3"
      data-log-id={entry.logId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <ValueChange from={entry.from} to={entry.to} />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <time dateTime={entry.at}>{at}</time>
            <span>{t('insights.why.chain.by', { actor })}</span>
            <EntryStateBadge state={entry.state} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CauseChip cause={entry.cause} />
            <ConfidenceBadge confidence={entry.confidence} />
          </div>
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={t('insights.why.chain.details.title')}
          onClick={() => onToggle(entry.logId)}
        >
          <ChevronDown className={cn('size-4 transition-transform duration-150', expanded && 'rotate-180')} aria-hidden="true" />
        </IconButton>
      </div>
      {expanded ? <EntryDetails entry={entry} id={detailsId} /> : null}
    </li>
  )
}

function GapNotice({ gap }: { gap: ExplainGapView }) {
  const t = useT()
  const locale = useLocale()
  const at = gap.at ? formatExplainDateTime(gap.at, locale) : null
  return (
    <li
      className="flex items-start gap-2 rounded-lg border border-dashed border-status-warning-border bg-status-warning-bg p-3 text-sm text-status-warning-text"
      data-gap-reason={gap.reason}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{t(`insights.explain.gaps.${gap.reason}`)}</p>
        {at ? <p className="text-xs">{t('insights.why.gaps.detectedAt', { at })}</p> : null}
      </div>
    </li>
  )
}

function HintItem({ hint }: { hint: ExplainHintView }) {
  const t = useT()
  const locale = useLocale()
  const detailKey = readTranslationKeyParam(hint.params, 'labelKey') ?? readTranslationKeyParam(hint.params, 'reasonKey')
  const reference = hint.reference ?? null
  const referenceHref = reference && isSafeInternalHref(reference.href) ? reference.href : null
  const referenceLabel = reference ? reference.label ?? reference.id : null
  return (
    <li className="flex items-start gap-2 text-sm text-foreground" data-hint-key={hint.key}>
      <Lightbulb className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="break-words">{t(hint.key, toTranslateParams(hint.params, locale))}</p>
        {detailKey ? <p className="text-xs text-muted-foreground">{t(detailKey)}</p> : null}
        {referenceLabel ? (
          referenceHref ? (
            <LinkButton asChild size="sm" underline="always">
              <Link href={referenceHref}>{referenceLabel}</Link>
            </LinkButton>
          ) : (
            <p className="text-xs text-muted-foreground">{referenceLabel}</p>
          )
        ) : null}
        {hint.confidence ? <ConfidenceBadge confidence={hint.confidence} /> : null}
      </div>
    </li>
  )
}

function hintIdentity(hint: ExplainHintView): string {
  return `${hint.key}:${JSON.stringify(hint.params ?? {})}:${hint.reference?.kind ?? ''}:${hint.reference?.id ?? ''}`
}

function collectHints(pages: readonly ExplainFieldResponse[]): ExplainHintView[] {
  const seen = new Set<string>()
  const result: ExplainHintView[] = []
  for (const page of pages) {
    for (const hint of page.hints ?? []) {
      const identity = hintIdentity(hint)
      if (seen.has(identity)) continue
      seen.add(identity)
      result.push(hint)
    }
  }
  return result
}

function gapIdentity(gap: ExplainGapView): string {
  return `${gap.afterLogId ?? ''}|${gap.beforeLogId ?? ''}|${gap.reason}`
}

function collectGaps(pages: readonly ExplainFieldResponse[]): ExplainGapView[] {
  const seen = new Set<string>()
  const result: ExplainGapView[] = []
  for (const page of pages) {
    for (const gap of page.gaps ?? []) {
      const identity = gapIdentity(gap)
      if (seen.has(identity)) continue
      seen.add(identity)
      result.push(gap)
    }
  }
  return result
}

type ChainItem =
  | { kind: 'entry'; entry: ExplainChainEntryView }
  | { kind: 'gap'; gap: ExplainGapView; key: string }

function buildChainItems(entries: readonly ExplainChainEntryView[], gaps: readonly ExplainGapView[]): {
  items: ChainItem[]
  detachedGaps: ExplainGapView[]
} {
  const entryIds = new Set(entries.map((entry) => entry.logId))
  const leading = gaps.filter((gap) => gap.beforeLogId === null)
  const following = new Map<string, ExplainGapView[]>()
  const detachedGaps: ExplainGapView[] = []
  for (const gap of gaps) {
    if (gap.beforeLogId === null) continue
    if (!entryIds.has(gap.beforeLogId)) {
      detachedGaps.push(gap)
      continue
    }
    const list = following.get(gap.beforeLogId) ?? []
    list.push(gap)
    following.set(gap.beforeLogId, list)
  }
  const items: ChainItem[] = leading.map((gap, index) => ({ kind: 'gap', gap, key: `gap:lead:${index}` }))
  for (const entry of entries) {
    items.push({ kind: 'entry', entry })
    for (const [index, gap] of (following.get(entry.logId) ?? []).entries()) {
      items.push({ kind: 'gap', gap, key: `gap:${entry.logId}:${index}` })
    }
  }
  return { items, detachedGaps }
}

export function WhyChain({ explanation, olderPages = [], olderStatus = 'idle', onLoadOlder, className }: WhyChainProps) {
  const t = useT()
  const locale = useLocale()
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set())
  const pages = React.useMemo(() => [explanation, ...olderPages], [explanation, olderPages])
  const entries = React.useMemo(() => pages.flatMap((page) => page.chain ?? []), [pages])
  const gaps = React.useMemo(() => collectGaps(pages), [pages])
  const hints = React.useMemo(() => collectHints(pages), [pages])
  const { items, detachedGaps } = React.useMemo(() => buildChainItems(entries, gaps), [entries, gaps])
  const lastPage = pages[pages.length - 1]
  const canLoadOlder = Boolean(onLoadOlder && lastPage?.page?.nextBefore)
  const summaryText = t(explanation.summary.key, toTranslateParams(explanation.summary.params, locale))
  const current = formatCurrentValue(explanation.current, t, locale)

  const toggle = React.useCallback((logId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(logId)) next.delete(logId)
      else next.add(logId)
      return next
    })
  }, [])

  return (
    <div className={cn('space-y-4', className)} data-testid="insights-why-chain">
      <section className="space-y-2" aria-label={t('insights.why.field.summary')}>
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict={explanation.verdict} />
          <ConfidenceBadge confidence={explanation.confidence} />
        </div>
        <p className="text-sm text-foreground">{summaryText}</p>
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="text-muted-foreground">{t('insights.why.field.current')}</span>
          <ValueText formatted={current} />
        </div>
      </section>

      {!explanation.viewer.canSeePastValues ? (
        <Alert status="information" style="lighter" size="sm">
          <AlertDescription>
            {explanation.viewer.canSeeOwnValues
              ? t('insights.why.values.redactedOthersHint')
              : t('insights.why.values.redactedHint')}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-2" aria-label={t('insights.why.chain.title')}>
        <h3 className="text-sm font-semibold">{t('insights.why.chain.title')}</h3>
        {items.length === 0 ? (
          <TabEmptyState title={t('insights.why.chain.empty.title')} description={summaryText} />
        ) : (
          <ol className="space-y-2">
            {items.map((item) =>
              item.kind === 'entry' ? (
                <ChainEntryItem
                  key={item.entry.logId}
                  entry={item.entry}
                  expanded={expanded.has(item.entry.logId)}
                  onToggle={toggle}
                />
              ) : (
                <GapNotice key={item.key} gap={item.gap} />
              ),
            )}
          </ol>
        )}
        {detachedGaps.length > 0 ? (
          <ul className="space-y-2">
            {detachedGaps.map((gap, index) => (
              <GapNotice key={`gap:detached:${index}`} gap={gap} />
            ))}
          </ul>
        ) : null}
        {olderStatus === 'error' ? (
          <ErrorMessage
            label={t('insights.why.chain.loadOlderError')}
            action={onLoadOlder ? (
              <Button type="button" variant="outline" size="sm" onClick={onLoadOlder}>
                {t('insights.why.retry')}
              </Button>
            ) : null}
          />
        ) : canLoadOlder ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLoadOlder}
            disabled={olderStatus === 'loading'}
          >
            {olderStatus === 'loading' ? <Spinner className="size-4" /> : null}
            {t('insights.why.chain.loadOlder')}
          </Button>
        ) : null}
      </section>

      {hints.length > 0 ? (
        <section className="space-y-2" aria-label={t('insights.why.hints.title')}>
          <h3 className="text-sm font-semibold">{t('insights.why.hints.title')}</h3>
          <ul className="space-y-2">
            {hints.map((hint) => (
              <HintItem key={hintIdentity(hint)} hint={hint} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

export default WhyChain
