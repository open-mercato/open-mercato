"use client"

import * as React from 'react'
import { AlertCircle, CheckCircle2, CircleDot, Gavel, Info, Loader2, Lock, TriangleAlert, Undo2, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useOptionalLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type { BlockTone } from '../contracts/shared'
import type {
  DecisionFact,
  Decision,
  DecisionHighlight,
  DecisionOutcome,
  DecisionPanelLayout,
  DecisionPanelProps,
  DecisionPanelVariant,
  DecisionRequester,
  DecisionTone,
} from '../contracts/decision-panel'

const ROOT_CLASS: Record<DecisionPanelVariant, string> = {
  card: 'rounded-card border border-border bg-card',
  plain: 'gap-4',
}

const BODY_CLASS: Record<DecisionPanelVariant, string> = {
  card: 'p-4',
  plain: '',
}

const FOOTER_CLASS: Record<DecisionPanelVariant, string> = {
  card: 'rounded-b-card border-t border-border bg-muted/40 px-4 py-3',
  plain: 'border-t border-border pt-4',
}

const FOOTER_ROW_CLASS: Record<DecisionPanelLayout, string> = {
  inline: 'flex min-w-0 flex-col gap-3 @md:flex-row @md:items-center',
  stacked: 'flex min-w-0 flex-col gap-3',
}

const BUTTON_ROW_CLASS: Record<DecisionPanelLayout, string> = {
  inline: 'flex min-w-0 flex-col-reverse gap-2 @md:ml-auto @md:shrink-0 @md:flex-row @md:items-center',
  stacked: 'flex min-w-0 flex-col-reverse gap-2',
}

const BUTTON_SIZE_CLASS: Record<DecisionPanelLayout, string> = {
  inline: 'h-10 w-full max-w-full font-normal @md:h-9 @md:w-auto',
  stacked: 'h-10 w-full max-w-full font-normal',
}

const SHORTCUT_HINT_CLASS = 'hidden shrink-0 whitespace-nowrap text-sm leading-5 text-muted-foreground'
const SHORTCUT_HINT_FEW_CLASS = '@lg:block'
const SHORTCUT_HINT_MANY_CLASS = '@2xl:block'
const SHORTCUT_HINT_MANY_FROM = 3

const BLOCKED_BUTTON_CLASS =
  'cursor-not-allowed border-border-disabled bg-bg-disabled text-text-disabled shadow-none hover:bg-bg-disabled hover:text-text-disabled'

const OUTCOME_TONE_BY_DECISION_TONE: Record<DecisionTone, BlockTone> = {
  primary: 'success',
  neutral: 'neutral',
  destructive: 'error',
}

const TONE_TINT_CLASS: Record<BlockTone, string> = {
  neutral: 'bg-muted text-status-neutral-text',
  info: 'bg-status-info-bg text-status-info-text',
  success: 'bg-status-success-bg text-status-success-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  error: 'bg-status-error-bg text-status-error-text',
}

const TONE_ICON_CLASS: Record<BlockTone, string> = {
  neutral: 'text-status-neutral-icon',
  info: 'text-status-info-icon',
  success: 'text-status-success-icon',
  warning: 'text-status-warning-icon',
  error: 'text-status-error-icon',
}

const TONE_EDGE_CLASS: Record<BlockTone, string> = {
  neutral: 'border-status-neutral-border',
  info: 'border-status-info-border',
  success: 'border-status-success-border',
  warning: 'border-status-warning-border',
  error: 'border-status-error-border',
}

const OUTCOME_ICON: Record<BlockTone, LucideIcon> = {
  neutral: CircleDot,
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: XCircle,
}

const RELATIVE_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const NAME_PLACEHOLDER = '\u0001'
const COMMENT_MIN_ROWS = 2
const COMMENT_MAX_ROWS = 6

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] DecisionPanel received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function DecisionIcon({ name }: { name: string | undefined }) {
  const Icon = resolveIcon(name)
  if (!Icon) return null
  return <Icon aria-hidden="true" className="size-4" />
}

function PendingIcon() {
  return <Loader2 aria-hidden="true" data-slot="decision-panel-pending-icon" className="size-4 animate-spin" />
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function'
}

function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

function formatAbsoluteTime(iso: string, locale: string | undefined): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function formatShortDate(iso: string, locale: string | undefined): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parsed)
}

function isWithinRelativeWindow(iso: string): boolean {
  const parsed = new Date(iso).getTime()
  return !Number.isNaN(parsed) && Math.abs(Date.now() - parsed) < RELATIVE_TIME_WINDOW_MS
}

function findMainDecisionId(decisions: Decision[]): string | undefined {
  return decisions.find((decision) => decision.tone === 'primary')?.id
}

function orderDecisions(decisions: Decision[], mainId: string | undefined): Decision[] {
  const secondary = decisions.filter((decision) => decision.id !== mainId).reverse()
  return [...secondary, ...decisions.filter((decision) => decision.id === mainId)]
}

function decisionButtonVariant(decision: Decision, mainId: string | undefined): 'default' | 'outline' | 'destructive-outline' {
  if (decision.tone === 'destructive') return 'destructive-outline'
  return decision.id === mainId ? 'default' : 'outline'
}

function resolveOutcomeTone(outcome: DecisionOutcome, decisions: Decision[]): BlockTone {
  if (outcome.tone) return outcome.tone
  const source = decisions.find((decision) => decision.id === outcome.decisionId)
  return source?.tone ? OUTCOME_TONE_BY_DECISION_TONE[source.tone] : 'neutral'
}

function isFocusUnplaced(): boolean {
  const active = document.activeElement
  return !active || active === document.body || !active.isConnected
}

function useShortcutKeys(): string {
  const [isApple, setIsApple] = React.useState(false)
  React.useEffect(() => {
    if (typeof navigator === 'undefined') return
    setIsApple(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent))
  }, [])
  return isApple ? 'Cmd+Enter' : 'Ctrl+Enter'
}

type SmartTimeProps = { iso: string; className?: string }

function SmartTime({ iso, className }: SmartTimeProps) {
  const t = useT()
  const locale = useOptionalLocale()
  const absolute = formatAbsoluteTime(iso, locale)
  const relative = isWithinRelativeWindow(iso) ? formatRelativeTime(iso, { locale, translate: t }) : null
  const text = relative ?? formatShortDate(iso, locale)
  if (!text) return null
  return (
    <time dateTime={iso} title={absolute || undefined} className={className}>
      {text}
    </time>
  )
}

type StatusChipProps = { tone: BlockTone; children: React.ReactNode }

function StatusChip({ tone, children }: StatusChipProps) {
  return (
    <span
      data-slot="decision-panel-chip"
      data-tone={tone}
      className={cn(
        'inline-flex min-h-6 max-w-full shrink-0 items-center rounded-badge px-2 text-sm leading-5',
        TONE_TINT_CLASS[tone],
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

type RequesterLineProps = { requester: DecisionRequester | undefined; requestedAt: string | undefined }

function RequesterLine({ requester, requestedAt }: RequesterLineProps) {
  const t = useT()
  if (!requester && !requestedAt) return null
  const template = requester
    ? t('ui.blocks.decisionPanel.requestedBy', '{name} requested', { name: NAME_PLACEHOLDER })
    : t('ui.blocks.decisionPanel.requested', 'Requested')
  const [beforeName, afterName] = requester ? template.split(NAME_PLACEHOLDER) : [template, undefined]
  return (
    <div data-slot="decision-panel-requester" className="flex min-w-0 items-start gap-2">
      {requester ? (
        <Avatar label={requester.name} src={requester.avatarUrl} size="sm" variant="monochrome" aria-hidden="true" className="font-normal" />
      ) : null}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="min-w-0 break-words text-sm leading-7 text-muted-foreground">
          {beforeName}
          {requester ? (
            <span data-slot="decision-panel-requester-name" className="text-foreground">
              {requester.name}
            </span>
          ) : null}
          {afterName}
          {requestedAt ? (
            <>
              {' '}
              <SmartTime iso={requestedAt} />
            </>
          ) : null}
        </p>
        {requester?.note ? (
          <blockquote data-slot="decision-panel-requester-note" className="mt-1 min-w-0 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm leading-5 text-muted-foreground">
            {requester.note}
          </blockquote>
        ) : null}
      </div>
    </div>
  )
}

type HeadingTag = 'h2' | 'h3' | 'h4'

type HeaderProps = {
  titleId: string
  title: string
  description: string | undefined
  headingTag: HeadingTag
  chipTone: BlockTone
  chipLabel: string | null
  requester: DecisionRequester | undefined
  requestedAt: string | undefined
}

function PanelHeader({ titleId, title, description, headingTag, chipTone, chipLabel, requester, requestedAt }: HeaderProps) {
  const Heading = headingTag
  return (
    <div data-slot="decision-panel-header" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <Heading id={titleId} data-slot="decision-panel-title" className="min-w-0 break-words text-base font-normal leading-6 text-foreground">
          {title}
        </Heading>
        {chipLabel ? <StatusChip tone={chipTone}>{chipLabel}</StatusChip> : null}
      </div>
      <RequesterLine requester={requester} requestedAt={requestedAt} />
      {description ? (
        <p data-slot="decision-panel-description" className="break-words text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  )
}

function PanelHighlight({ highlight }: { highlight: DecisionHighlight }) {
  const captionTone = highlight.captionTone
  return (
    <dl data-slot="decision-panel-highlight" className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm leading-5 text-muted-foreground">{highlight.label}</dt>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <dd data-slot="decision-panel-highlight-value" className="min-w-0 break-words text-3xl font-normal leading-9 tabular-nums text-foreground">
          {highlight.value}
        </dd>
        {highlight.caption ? (
          <dd
            data-slot="decision-panel-highlight-caption"
            data-tone={captionTone}
            className={cn(
              'min-w-0 break-words text-sm leading-5',
              captionTone ? cn('rounded-badge px-2 py-px', TONE_TINT_CLASS[captionTone]) : 'text-muted-foreground',
            )}
          >
            {highlight.caption}
          </dd>
        ) : null}
      </div>
    </dl>
  )
}

function PanelFacts({ facts }: { facts: DecisionFact[] }) {
  return (
    <dl data-slot="decision-panel-facts" className="min-w-0 divide-y divide-border border-y border-border">
      {facts.map((fact) => (
        <div key={fact.key} data-slot="decision-panel-fact" className="grid min-w-0 grid-cols-3 gap-x-4 py-2 text-sm leading-5">
          <dt className="min-w-0 break-words text-muted-foreground">{fact.label}</dt>
          <dd className="col-span-2 min-w-0 break-words text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

type SkeletonProps = { label: string; variant: DecisionPanelVariant; layout: DecisionPanelLayout; className: string | undefined }

function DecisionPanelSkeleton({ label, variant, layout, className }: SkeletonProps) {
  return (
    <div
      data-slot="decision-panel"
      data-variant={variant}
      aria-busy="true"
      className={cn('@container flex w-full min-w-0 flex-col', ROOT_CLASS[variant], className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={cn('flex flex-col gap-4', BODY_CLASS[variant])}>
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-6 w-40 max-w-full" />
            <Skeleton className="h-6 w-32 shrink-0 rounded-badge" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <Skeleton className="h-5 w-56 max-w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-9 w-44 max-w-full" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
      <div aria-hidden="true" className={FOOTER_CLASS[variant]}>
        <div className={FOOTER_ROW_CLASS[layout]}>
          <div className={BUTTON_ROW_CLASS[layout]}>
            <Skeleton className={cn(BUTTON_SIZE_CLASS[layout], layout === 'inline' && '@md:w-24')} />
            <Skeleton className={cn(BUTTON_SIZE_CLASS[layout], layout === 'inline' && '@md:w-28')} />
          </div>
        </div>
      </div>
    </div>
  )
}

type OutcomeProps = {
  outcome: DecisionOutcome
  tone: BlockTone
  undoLabel: string | undefined
  onUndo: (() => void | Promise<void>) | undefined
}

const DecisionOutcomeBanner = React.forwardRef<HTMLDivElement, OutcomeProps>(function DecisionOutcomeBanner(
  { outcome, tone, undoLabel, onUndo },
  ref,
) {
  const t = useT()
  const [undoPending, setUndoPending] = React.useState(false)
  const OutcomeIcon = OUTCOME_ICON[tone]
  const sentence = outcome.by
    ? t('ui.blocks.decisionPanel.outcomeBy', '{decision} by {name}', { decision: outcome.label, name: outcome.by })
    : outcome.label

  const handleUndo = () => {
    if (undoPending) return
    const result = onUndo?.()
    if (!isPromise(result)) return
    setUndoPending(true)
    const clear = () => setUndoPending(false)
    result.then(clear, clear)
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label={t('ui.blocks.decisionPanel.outcomeLabel', 'Decision')}
      data-slot="decision-panel-outcome"
      data-tone={tone}
      className={cn('flex min-w-0 items-start gap-3 rounded-md p-3 outline-none focus-visible:shadow-focus', TONE_TINT_CLASS[tone])}
    >
      <span aria-hidden="true" className="flex h-6 shrink-0 items-center">
        <OutcomeIcon className={cn('size-5', TONE_ICON_CLASS[tone])} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-x-3 gap-y-2 @md:flex-row @md:items-start @md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="min-w-0 break-words text-base leading-6">
            <span data-slot="decision-panel-outcome-sentence">{sentence}</span>
            {outcome.at ? (
              <>
                {' '}
                <SmartTime iso={outcome.at} className="whitespace-nowrap text-sm text-muted-foreground" />
              </>
            ) : null}
          </p>
          {outcome.comment ? (
            <blockquote
              data-slot="decision-panel-outcome-comment"
              className={cn('min-w-0 whitespace-pre-wrap break-words border-l-2 pl-3 text-sm leading-5 text-foreground', TONE_EDGE_CLASS[tone])}
            >
              {outcome.comment}
            </blockquote>
          ) : null}
        </div>
        {onUndo ? (
          <Button
            type="button"
            variant="link"
            data-slot="decision-panel-undo"
            aria-disabled={undoPending ? 'true' : undefined}
            aria-busy={undoPending || undefined}
            className="h-10 shrink-0 justify-start gap-2 self-start px-0 font-normal text-foreground has-[>svg]:px-0 @md:-my-1 @md:h-8"
            onClick={handleUndo}
          >
            {undoPending ? <PendingIcon /> : <Undo2 aria-hidden="true" className="size-4" />}
            <span className="min-w-0 truncate">{undoLabel ?? t('ui.blocks.decisionPanel.undo', 'Undo decision')}</span>
          </Button>
        ) : null}
      </div>
    </div>
  )
})

export function DecisionPanel(props: DecisionPanelProps) {
  const t = useT()
  const {
    state,
    title,
    description,
    headingLevel = 3,
    statusLabel,
    requester,
    requestedAt,
    highlight,
    facts,
    decisions = [],
    onDecide,
    submittingDecisionId,
    commentMode = 'optional',
    commentLabel,
    commentPlaceholder,
    commentRequiredMessage,
    comment,
    onCommentChange,
    decided,
    onUndo,
    undoLabel,
    disabledReason,
    children,
    footer,
    variant = 'card',
    layout = 'inline',
    status,
    errorMessage,
    onRetry,
    emptyState,
    className,
  } = props

  const shortcutKeys = useShortcutKeys()
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const commentId = `${baseId}-comment`
  const commentHintId = `${baseId}-comment-hint`
  const commentErrorId = `${baseId}-comment-error`
  const confirmTitleId = `${baseId}-confirm-title`
  const confirmDescriptionId = `${baseId}-confirm-description`

  const rootRef = React.useRef<HTMLElement | null>(null)
  const commentRef = React.useRef<HTMLTextAreaElement | null>(null)
  const outcomeRef = React.useRef<HTMLDivElement | null>(null)
  const confirmCancelRef = React.useRef<HTMLButtonElement | null>(null)
  const confirmAcceptRef = React.useRef<HTMLButtonElement | null>(null)
  const focusHeldRef = React.useRef(false)

  const [localComment, setLocalComment] = React.useState('')
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null)
  const [commentMissing, setCommentMissing] = React.useState(false)
  const [submitFailed, setSubmitFailed] = React.useState(false)

  const isDecided = state === 'decided' && decided !== undefined
  const commentValue = comment ?? localComment
  const activeSubmittingId = submittingDecisionId ?? pendingId
  const isSubmitting = state === 'submitting' || activeSubmittingId !== null
  const isLocked = Boolean(disabledReason)
  const showComment = commentMode !== 'none' && !isLocked
  const mainId = findMainDecisionId(decisions)
  const orderedDecisions = orderDecisions(decisions, mainId)
  const confirmingDecision = confirmingId ? decisions.find((decision) => decision.id === confirmingId) : undefined
  const view: 'decided' | 'confirm' | 'pending' = isDecided ? 'decided' : confirmingDecision?.confirm ? 'confirm' : 'pending'
  const previousViewRef = React.useRef(view)
  const lastConfirmedIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (state !== 'decided') return
    lastConfirmedIdRef.current = null
    setLocalComment('')
    setConfirmingId(null)
    setCommentMissing(false)
    setSubmitFailed(false)
  }, [state])

  React.useLayoutEffect(() => {
    const previousView = previousViewRef.current
    previousViewRef.current = view
    if (previousView === view) return
    const root = rootRef.current
    const active = document.activeElement
    const focusInside = Boolean(root && active && root.contains(active))
    if (!focusInside && !(focusHeldRef.current && isFocusUnplaced())) return
    if (view === 'decided') {
      outcomeRef.current?.focus()
      return
    }
    if (view === 'confirm') {
      const target = confirmingDecision?.tone === 'destructive' ? confirmCancelRef.current : confirmAcceptRef.current
      target?.focus()
      return
    }
    const returnId = lastConfirmedIdRef.current
    const returnButton = returnId
      ? Array.from(root?.querySelectorAll<HTMLElement>('[data-slot="decision-panel-decision"]') ?? []).find(
          (node) => node.dataset.decisionId === returnId,
        )
      : undefined
    const fallback = commentRef.current ?? root?.querySelector<HTMLElement>('[data-slot="decision-panel-decision"]')
    ;(returnButton ?? fallback)?.focus()
  }, [view, confirmingDecision])

  const handleFocus = React.useCallback(() => {
    focusHeldRef.current = true
  }, [])
  const handleBlur = React.useCallback((event: React.FocusEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    if (nextTarget === null && !event.target.isConnected) return
    focusHeldRef.current = false
  }, [])

  const headingTag = `h${headingLevel}` as HeadingTag

  if (status === 'loading') {
    return (
      <DecisionPanelSkeleton
        label={t('ui.blocks.decisionPanel.loading', 'Loading')}
        variant={variant}
        layout={layout}
        className={className}
      />
    )
  }

  if (status === 'error') {
    return (
      <ErrorMessage
        label={errorMessage ?? t('ui.blocks.decisionPanel.error', 'Something went wrong')}
        className={cn('max-w-xl rounded-md', className)}
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="font-normal text-foreground" onClick={onRetry}>
              {t('ui.blocks.decisionPanel.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (status === 'empty') {
    if (emptyState) return <div className={className}>{emptyState}</div>
    return (
      <EmptyState
        size="sm"
        icon={<Gavel aria-hidden />}
        title={t('ui.blocks.decisionPanel.empty', 'Nothing to decide')}
        description={t('ui.blocks.decisionPanel.emptyDescription', 'Requests that need a decision will appear here.')}
        className={cn('items-start px-0 text-left', className)}
      />
    )
  }

  const changeComment = (value: string) => {
    if (comment === undefined) setLocalComment(value)
    onCommentChange?.(value)
    if (commentMissing && value.trim()) setCommentMissing(false)
  }

  const submit = (decision: Decision) => {
    const trimmed = commentValue.trim()
    setSubmitFailed(false)
    const result = onDecide?.(decision.id, showComment && trimmed ? trimmed : undefined)
    if (!isPromise(result)) return
    setPendingId(decision.id)
    result.then(
      () => setPendingId(null),
      () => {
        setPendingId(null)
        setSubmitFailed(true)
      },
    )
  }

  const requestDecision = (decision: Decision) => {
    if (isSubmitting || isLocked || decision.disabled) return
    const needsComment = showComment && (commentMode === 'required' || decision.commentRequired === true)
    if (needsComment && !commentValue.trim()) {
      setCommentMissing(true)
      commentRef.current?.focus()
      return
    }
    setCommentMissing(false)
    if (decision.confirm) {
      lastConfirmedIdRef.current = decision.id
      setConfirmingId(decision.id)
      return
    }
    submit(decision)
  }

  const cancelConfirm = () => setConfirmingId(null)

  const acceptConfirm = () => {
    if (!confirmingDecision || isSubmitting) return
    setConfirmingId(null)
    submit(confirmingDecision)
  }

  const handleCommentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitShortcut(event)) return
    const mainDecision = decisions.find((decision) => decision.id === mainId)
    if (!mainDecision) return
    event.preventDefault()
    if (view === 'confirm') {
      acceptConfirm()
      return
    }
    requestDecision(mainDecision)
  }

  const handleConfirmKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelConfirm()
      return
    }
    if (!isSubmitShortcut(event)) return
    event.preventDefault()
    acceptConfirm()
  }

  const requiredLabels = decisions.filter((decision) => decision.commentRequired).map((decision) => decision.label)
  const hasRequiredDecisions = commentMode === 'optional' && requiredLabels.length > 0
  const showRequiredHint = hasRequiredDecisions && !commentMissing
  const submitErrorText =
    !isSubmitting && view !== 'decided'
      ? errorMessage ?? (submitFailed ? t('ui.blocks.decisionPanel.submitFailed', 'Could not record the decision') : undefined)
      : undefined
  const commentDescribedBy =
    [commentMissing ? commentErrorId : null, showRequiredHint ? commentHintId : null].filter(Boolean).join(' ') || undefined
  const decisionReasons = orderedDecisions.filter((decision) => decision.disabled && decision.disabledReason)
  const mainDecision = decisions.find((decision) => decision.id === mainId)
  const showShortcutHint = showComment && mainDecision !== undefined && !mainDecision.disabled && decisionReasons.length === 0
  const submittingLabel = decisions.find((decision) => decision.id === activeSubmittingId)?.label
  const announcement = isDecided
    ? t('ui.blocks.decisionPanel.announceDecided', 'Decision recorded: {decision}', { decision: decided.label })
    : isSubmitting
      ? submittingLabel
        ? t('ui.blocks.decisionPanel.announceSubmittingDecision', 'Submitting: {decision}', { decision: submittingLabel })
        : t('ui.blocks.decisionPanel.announceSubmitting', 'Submitting the decision')
      : ''
  const outcomeTone = isDecided ? resolveOutcomeTone(decided, decisions) : 'neutral'
  const chipTone: BlockTone = isDecided ? outcomeTone : isLocked ? 'neutral' : 'info'
  const chipLabel = isDecided
    ? decided.label
    : statusLabel ??
      (isLocked
        ? t('ui.blocks.decisionPanel.awaitingApproval', 'Awaiting approval')
        : t('ui.blocks.decisionPanel.awaitingYourDecision', 'Awaiting your decision'))

  const commentField = showComment ? (
    <div data-slot="decision-panel-comment" className="flex min-w-0 flex-col gap-1">
      <FieldLabel
        htmlFor={commentId}
        required={commentMode === 'required'}
        className="[&_label]:font-normal"
        sublabel={
          commentMode === 'optional' && !hasRequiredDecisions ? (
            <span className="pl-1">{t('ui.blocks.decisionPanel.commentOptional', '(optional)')}</span>
          ) : undefined
        }
      >
        {commentLabel ?? t('ui.blocks.decisionPanel.comment', 'Comment')}
      </FieldLabel>
      <Textarea
        ref={commentRef}
        id={commentId}
        value={commentValue}
        rows={COMMENT_MIN_ROWS}
        autoResize
        maxRows={COMMENT_MAX_ROWS}
        placeholder={commentPlaceholder}
        readOnly={isSubmitting || view === 'confirm'}
        aria-required={commentMode === 'required' || undefined}
        aria-invalid={commentMissing || undefined}
        aria-describedby={commentDescribedBy}
        className="min-h-14 read-only:bg-muted/40 read-only:text-muted-foreground"
        onChange={(event) => changeComment(event.target.value)}
        onKeyDown={handleCommentKeyDown}
      />
      {showRequiredHint ? (
        <p id={commentHintId} data-slot="decision-panel-comment-hint" className="text-sm leading-5 text-muted-foreground">
          {t('ui.blocks.decisionPanel.commentRequiredFor', 'Required for: {decisions}', {
            decisions: requiredLabels.join(', '),
          })}
        </p>
      ) : null}
      {commentMissing ? (
        <p
          id={commentErrorId}
          role="alert"
          data-slot="decision-panel-comment-error"
          className="flex items-start gap-2 text-sm leading-5 text-status-error-text"
        >
          <span aria-hidden="true" className="flex h-5 shrink-0 items-center">
            <AlertCircle className="size-4 text-status-error-icon" />
          </span>
          <span className="min-w-0 break-words">
            {commentRequiredMessage ?? t('ui.blocks.decisionPanel.commentRequired', 'This decision needs a comment')}
          </span>
        </p>
      ) : null}
    </div>
  ) : null

  const decisionsRow = (
    <div data-slot="decision-panel-actions" className={FOOTER_ROW_CLASS[layout]}>
      {decisionReasons.length > 0 ? (
        <ul data-slot="decision-panel-decision-reasons" className="flex min-w-0 flex-1 flex-col gap-1">
          {decisionReasons.map((decision) => (
            <li
              key={decision.id}
              id={`${baseId}-reason-${decision.id}`}
              className="break-words text-sm leading-5 text-muted-foreground"
            >
              {decision.disabledReason}
            </li>
          ))}
        </ul>
      ) : null}
      {showShortcutHint ? (
        <p
          data-slot="decision-panel-shortcut"
          className={cn(
            SHORTCUT_HINT_CLASS,
            layout === 'inline' &&
              (decisions.length >= SHORTCUT_HINT_MANY_FROM ? SHORTCUT_HINT_MANY_CLASS : SHORTCUT_HINT_FEW_CLASS),
          )}
        >
          {t('ui.blocks.decisionPanel.shortcutHint', '{decision} with {keys}', {
            keys: shortcutKeys,
            decision: mainDecision.label,
          })}
        </p>
      ) : null}
      <div
        data-slot="decision-panel-decisions"
        data-layout={layout}
        role="group"
        aria-label={t('ui.blocks.decisionPanel.decisionsLabel', 'Decisions')}
        className={BUTTON_ROW_CLASS[layout]}
      >
        {orderedDecisions.map((decision) => {
          const isThisSubmitting = isSubmitting && activeSubmittingId === decision.id
          const hardDisabled = decision.disabled === true && !decision.disabledReason
          const blocked = !isThisSubmitting && (isSubmitting || Boolean(decision.disabledReason))
          const softDisabled = blocked || isThisSubmitting
          return (
            <Button
              key={decision.id}
              type="button"
              variant={decisionButtonVariant(decision, mainId)}
              data-slot="decision-panel-decision"
              data-decision-id={decision.id}
              data-tone={decision.tone ?? 'neutral'}
              disabled={hardDisabled}
              aria-disabled={!hardDisabled && softDisabled ? 'true' : undefined}
              aria-busy={isThisSubmitting || undefined}
              aria-describedby={decision.disabledReason ? `${baseId}-reason-${decision.id}` : undefined}
              className={cn(BUTTON_SIZE_CLASS[layout], blocked && BLOCKED_BUTTON_CLASS, isThisSubmitting && 'cursor-progress')}
              onClick={() => requestDecision(decision)}
            >
              {isThisSubmitting ? <PendingIcon /> : <DecisionIcon name={decision.icon} />}
              <span className="min-w-0 truncate">{decision.label}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )

  const confirmRow = confirmingDecision?.confirm ? (
    <div
      role="group"
      aria-labelledby={confirmTitleId}
      aria-describedby={confirmingDecision.confirm.description ? confirmDescriptionId : undefined}
      data-slot="decision-panel-confirm"
      className={FOOTER_ROW_CLASS[layout]}
      onKeyDown={handleConfirmKeyDown}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <p id={confirmTitleId} data-slot="decision-panel-confirm-title" className="break-words text-sm leading-5 text-foreground">
          {confirmingDecision.confirm.title}
        </p>
        {confirmingDecision.confirm.description ? (
          <p
            id={confirmDescriptionId}
            data-slot="decision-panel-confirm-description"
            className="break-words text-sm leading-5 text-muted-foreground"
          >
            {confirmingDecision.confirm.description}
          </p>
        ) : null}
      </div>
      <div className={BUTTON_ROW_CLASS[layout]}>
        <Button
          ref={confirmCancelRef}
          type="button"
          variant="outline"
          data-slot="decision-panel-confirm-cancel"
          className={BUTTON_SIZE_CLASS[layout]}
          onClick={cancelConfirm}
        >
          <span className="min-w-0 truncate">{t('ui.blocks.decisionPanel.cancel', 'Cancel')}</span>
        </Button>
        <Button
          ref={confirmAcceptRef}
          type="button"
          variant={confirmingDecision.tone === 'destructive' ? 'destructive-solid' : 'default'}
          data-slot="decision-panel-confirm-accept"
          className={BUTTON_SIZE_CLASS[layout]}
          onClick={acceptConfirm}
        >
          <DecisionIcon name={confirmingDecision.icon} />
          <span className="min-w-0 truncate">{confirmingDecision.confirm.confirmLabel ?? confirmingDecision.label}</span>
        </Button>
      </div>
    </div>
  ) : null

  const lockedRow = (
    <p data-slot="decision-panel-reason" className="flex min-w-0 items-start gap-2 text-sm leading-5 text-muted-foreground">
      <span aria-hidden="true" className="flex h-5 shrink-0 items-center">
        <Lock className="size-4" />
      </span>
      <span className="min-w-0 break-words">{disabledReason}</span>
    </p>
  )

  return (
    <section
      ref={rootRef}
      aria-labelledby={titleId}
      aria-busy={isSubmitting || undefined}
      data-slot="decision-panel"
      data-state={isDecided ? 'decided' : isSubmitting ? 'submitting' : 'pending'}
      data-variant={variant}
      className={cn('@container flex w-full min-w-0 flex-col', ROOT_CLASS[variant], className)}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div data-slot="decision-panel-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      <div data-slot="decision-panel-body" className={cn('flex min-w-0 flex-col gap-4', BODY_CLASS[variant])}>
        <PanelHeader
          titleId={titleId}
          title={title}
          description={description}
          headingTag={headingTag}
          chipTone={chipTone}
          chipLabel={isDecided ? null : chipLabel}
          requester={requester}
          requestedAt={requestedAt}
        />
        {highlight ? <PanelHighlight highlight={highlight} /> : null}
        {facts && facts.length > 0 ? <PanelFacts facts={facts} /> : null}
        {children ? (
          <div data-slot="decision-panel-content" className="min-w-0">
            {children}
          </div>
        ) : null}
        {isDecided ? (
          <DecisionOutcomeBanner ref={outcomeRef} outcome={decided} tone={outcomeTone} undoLabel={undoLabel} onUndo={onUndo} />
        ) : (
          commentField
        )}
        {submitErrorText ? (
          <p
            role="alert"
            data-slot="decision-panel-error"
            className="flex min-w-0 items-start gap-2 rounded-md bg-status-error-bg p-3 text-sm leading-5 text-status-error-text"
          >
            <span aria-hidden="true" className="flex h-5 shrink-0 items-center">
              <AlertCircle className="size-4 text-status-error-icon" />
            </span>
            <span className="min-w-0 break-words">{submitErrorText}</span>
          </p>
        ) : null}
        {footer ? (
          <div data-slot="decision-panel-footer" className="min-w-0 text-sm leading-5 text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
      {isDecided ? null : (
        <div data-slot="decision-panel-bar" className={FOOTER_CLASS[variant]}>
          {isLocked ? lockedRow : view === 'confirm' ? confirmRow : decisionsRow}
        </div>
      )}
    </section>
  )
}
