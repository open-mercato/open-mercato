"use client"

import * as React from 'react'
import { Check, Lock, Milestone, Minus, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { cn } from '@open-mercato/shared/lib/utils'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import type {
  StagePathAppearance,
  StagePathOutcome,
  StagePathOutcomeTone,
  StagePathProps,
  StagePathSize,
  StagePathStage,
  StagePathVariant,
} from '../contracts/stage-path'

export type StagePathStageState = 'done' | 'current' | 'upcoming' | 'ended' | 'unreached'

type Translate = ReturnType<typeof useT>
type Palette = 'open' | 'success' | 'closed'
type ClosedTone = Exclude<StagePathOutcomeTone, 'success'>

const logger = createLogger('ui')
const reportedUnknownIcons = new Set<string>()

const MIN_SEGMENT_REM = 4.5
const MAX_SEGMENT_REM = 9
const FALLBACK_ROOT_FONT_PX = 16
const BAR_GAP_PX = 2
const BAR_CHROME_PX = 44
const MARKERS_GAP_PX = 8
const MARKERS_CHROME_PX = 16
const SKELETON_MAX_ROWS = 5

function resolveIcon(name: string | undefined) {
  const Icon = resolveRegisteredLucideIcon(name)
  if (Icon || !name || process.env.NODE_ENV === 'production' || reportedUnknownIcons.has(name)) return Icon
  reportedUnknownIcons.add(name)
  logger.warn('[internal] StagePath received an icon name that is not in the icon registry', { icon: name })
  return Icon
}

function isPromise(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value) && typeof (value as Promise<void>).then === 'function'
}

export function resolveStageStates(
  stages: ReadonlyArray<StagePathStage>,
  currentStageId: string,
  completedStageIds: ReadonlyArray<string> | undefined,
  outcome: StagePathOutcome | undefined,
): StagePathStageState[] {
  const currentIndex = stages.findIndex((stage) => stage.id === currentStageId)
  const completed = completedStageIds ? new Set(completedStageIds) : null
  return stages.map((stage, index) => {
    if (index === currentIndex) {
      if (!outcome) return 'current'
      return outcome.tone === 'success' ? 'done' : 'ended'
    }
    const isDone = completed ? completed.has(stage.id) : index < currentIndex
    if (isDone) return 'done'
    return outcome ? 'unreached' : 'upcoming'
  })
}

function resolvePalette(outcome: StagePathOutcome | undefined): Palette {
  if (!outcome) return 'open'
  return outcome.tone === 'success' ? 'success' : 'closed'
}

function closedTone(outcome: StagePathOutcome | undefined): ClosedTone {
  return outcome?.tone === 'error' ? 'error' : 'neutral'
}

function isReached(state: StagePathStageState | undefined): boolean {
  return state === 'done' || state === 'current' || state === 'ended'
}

function stateLabel(state: StagePathStageState, t: Translate): string {
  if (state === 'done') return t('ui.blocks.stagePath.state.done', 'done')
  if (state === 'current') return t('ui.blocks.stagePath.state.current', 'current')
  if (state === 'ended') return t('ui.blocks.stagePath.state.ended', 'ended here')
  if (state === 'unreached') return t('ui.blocks.stagePath.state.unreached', 'not reached')
  return t('ui.blocks.stagePath.state.upcoming', 'not started')
}

const VARIANT_CLASS: Record<StagePathVariant, string> = {
  plain: '',
  card: 'rounded-card border border-border bg-card p-4',
}

const FADE_FROM_CLASS: Record<StagePathVariant, string> = {
  plain: 'from-background',
  card: 'from-card',
}

const DONE_FILL_CLASS: Record<Palette, string> = {
  open: 'bg-status-info-bg text-foreground',
  success: 'bg-status-success-bg text-status-success-text',
  closed: 'bg-muted text-muted-foreground',
}

const DONE_GLYPH_CLASS: Record<Palette, string> = {
  open: 'text-status-info-icon',
  success: 'text-status-success-icon',
  closed: '',
}

const DONE_HOVER_CLASS: Record<Palette, string> = {
  open: 'group-hover:bg-status-info-border',
  success: 'group-hover:bg-status-success-border',
  closed: 'group-hover:bg-muted-foreground/30 group-hover:text-foreground',
}

const ENDED_FILL_CLASS: Record<ClosedTone, string> = {
  error: 'bg-status-error-bg text-status-error-text ring-1 ring-inset ring-status-error-border',
  neutral: 'bg-status-neutral-solid text-status-neutral-solid-foreground',
}

const ENDED_GLYPH_CLASS: Record<ClosedTone, string> = {
  error: 'text-status-error-icon',
  neutral: '',
}

const ENDED_ICON: Record<ClosedTone, typeof Check> = {
  error: X,
  neutral: Minus,
}

const CURRENT_FILL_CLASS = 'bg-status-info-solid text-status-info-solid-foreground'
const UPCOMING_FILL_CLASS = 'bg-muted text-muted-foreground'
const UNREACHED_FILL_CLASS = 'border border-dashed border-muted-foreground/40 text-muted-foreground'
const BLOCKED_FILL_CLASS = 'bg-muted/60 text-muted-foreground/70'
const QUIET_HOVER_CLASS = 'group-hover:bg-muted-foreground/30 group-hover:text-foreground'

const OUTCOME_MARKER_CLASS: Record<StagePathOutcomeTone, string> = {
  success: 'bg-status-success-solid text-status-success-solid-foreground',
  error: 'bg-status-error-solid text-status-error-solid-foreground',
  neutral: 'bg-status-neutral-solid text-status-neutral-solid-foreground',
}

const OUTCOME_TEXT_CLASS: Record<StagePathOutcomeTone, string> = {
  success: 'text-status-success-text',
  error: 'text-status-error-text',
  neutral: 'text-status-neutral-text',
}

const OUTCOME_ICON: Record<StagePathOutcomeTone, typeof Check> = {
  success: Check,
  error: X,
  neutral: Minus,
}

type StageVisual = {
  fill: string
  hover: string
  glyphClass: string
  Glyph: typeof Check | null
}

function resolveStageVisual(state: StagePathStageState, palette: Palette, tone: ClosedTone, blocked: boolean): StageVisual {
  if (blocked) return { fill: BLOCKED_FILL_CLASS, hover: '', glyphClass: '', Glyph: Lock }
  if (state === 'current') return { fill: CURRENT_FILL_CLASS, hover: '', glyphClass: '', Glyph: null }
  if (state === 'ended') return { fill: ENDED_FILL_CLASS[tone], hover: '', glyphClass: ENDED_GLYPH_CLASS[tone], Glyph: ENDED_ICON[tone] }
  if (state === 'done') {
    return { fill: DONE_FILL_CLASS[palette], hover: DONE_HOVER_CLASS[palette], glyphClass: DONE_GLYPH_CLASS[palette], Glyph: Check }
  }
  if (state === 'unreached') return { fill: UNREACHED_FILL_CLASS, hover: QUIET_HOVER_CLASS, glyphClass: '', Glyph: null }
  return { fill: UPCOMING_FILL_CLASS, hover: QUIET_HOVER_CLASS, glyphClass: '', Glyph: null }
}

type StageTooltipInput = {
  stage: StagePathStage
  labelHidden: boolean
  withDetails: boolean
  reason: string | undefined
}

function buildStageTooltip({ stage, labelHidden, withDetails, reason }: StageTooltipInput): React.ReactNode {
  const details = [withDetails ? stage.description : undefined, withDetails ? stage.meta : undefined, reason].filter(
    (line): line is string => Boolean(line),
  )
  if (!labelHidden && details.length === 0) return null
  return (
    <span data-slot="stage-path-tooltip" className="flex flex-col text-left">
      {labelHidden ? <span>{stage.label}</span> : null}
      {details.map((line) => (
        <span key={line} className={labelHidden ? 'opacity-80' : undefined}>
          {line}
        </span>
      ))}
    </span>
  )
}

type StageItemProps = {
  stage: StagePathStage
  state: StagePathStageState
  palette: Palette
  tone: ClosedTone
  index: number
  count: number
  isCurrent: boolean
  size: StagePathSize
  collapsed: boolean
  scrolls: boolean
  truncated: boolean
  detailsInSummary: boolean
  summaryId: string | undefined
  interactive: boolean
  locked: boolean
  pending: boolean
  tabStop: boolean
  onSelect: (stage: StagePathStage) => void
  onFocusStage: (stageId: string) => void
  t: Translate
}

type StageShellProps = {
  props: StageItemProps
  blocked: boolean
  reasonId: string
  tooltip: React.ReactNode
  className: string
  children: React.ReactNode
}

function StageShell({ props, blocked, reasonId, tooltip, className, children }: StageShellProps) {
  const { stage, isCurrent, summaryId, interactive, locked, pending, tabStop, onSelect, onFocusStage } = props
  const hasReason = blocked && Boolean(stage.disabledReason)
  const describedBy = [hasReason ? reasonId : undefined, isCurrent ? summaryId : undefined].filter(Boolean).join(' ')
  if (!interactive) {
    const plain = (
      <span data-slot="stage-path-stage" data-stage-id={stage.id} className={className}>
        {children}
      </span>
    )
    return tooltip ? <SimpleTooltip content={tooltip}>{plain}</SimpleTooltip> : plain
  }
  const button = (
    <button
      type="button"
      data-slot="stage-path-stage"
      data-stage-id={stage.id}
      tabIndex={tabStop ? 0 : -1}
      aria-disabled={blocked || locked ? 'true' : undefined}
      aria-busy={pending || undefined}
      aria-describedby={describedBy || undefined}
      className={cn(
        'group outline-none',
        className,
        blocked ? 'cursor-not-allowed' : locked || isCurrent ? 'cursor-default' : 'cursor-pointer',
      )}
      onFocus={() => onFocusStage(stage.id)}
      onClick={() => onSelect(stage)}
    >
      {children}
    </button>
  )
  return (
    <>
      {tooltip ? <SimpleTooltip content={tooltip}>{button}</SimpleTooltip> : button}
      {hasReason ? (
        <span id={reasonId} data-slot="stage-path-reason" className="sr-only">
          {stage.disabledReason}
        </span>
      ) : null}
    </>
  )
}

function StageHiddenText({ props, labelVisible, withDetails }: { props: StageItemProps; labelVisible: boolean; withDetails: boolean }) {
  const { stage, state, t } = props
  return (
    <span className="sr-only">
      {labelVisible ? null : `${stage.label} `}
      {stateLabel(state, t)}
      {withDetails && stage.description ? ` ${stage.description}` : null}
      {withDetails && stage.meta ? ` ${stage.meta}` : null}
    </span>
  )
}

function BarStage(props: StageItemProps) {
  const { stage, state, palette, tone, index, count, isCurrent, size, collapsed, scrolls, truncated, interactive, locked, pending } = props
  const reasonId = React.useId()
  const blocked = interactive && stage.disabled === true
  const selectable = interactive && !blocked && !locked && !isCurrent
  const visual = resolveStageVisual(state, palette, tone, blocked)
  const StageIcon = resolveIcon(stage.icon)
  const labelVisible = !collapsed || isCurrent
  const withDetails = !isCurrent || !props.detailsInSummary
  const glyphSize = size === 'compact' ? 'size-3' : 'size-4'
  const tooltip = buildStageTooltip({
    stage,
    labelHidden: !labelVisible || truncated,
    withDetails,
    reason: blocked ? stage.disabledReason : undefined,
  })

  let glyph: React.ReactNode = null
  if (pending) glyph = <Spinner size="sm" className={cn('shrink-0', glyphSize)} />
  else if (visual.Glyph) glyph = <visual.Glyph aria-hidden="true" className={cn('shrink-0', glyphSize, visual.glyphClass)} />
  else if (StageIcon && labelVisible) glyph = <StageIcon aria-hidden="true" className={cn('shrink-0', glyphSize)} />

  const segment = (
    <span
      data-slot="stage-path-segment"
      data-state={state}
      className={cn(
        'flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded-xs text-sm leading-5 transition-colors',
        size === 'compact' ? 'h-6' : 'h-8',
        labelVisible ? 'px-2' : 'px-0',
        index === 0 && 'rounded-l-md',
        index === count - 1 && 'rounded-r-md',
        visual.fill,
        selectable && visual.hover,
        interactive && 'group-focus-visible:relative group-focus-visible:shadow-focus',
      )}
    >
      {glyph}
      {labelVisible ? (
        <span data-slot="stage-path-label" data-stage-id={stage.id} className={scrolls ? 'whitespace-nowrap' : 'truncate'}>
          {stage.label}
        </span>
      ) : null}
      <StageHiddenText props={props} labelVisible={labelVisible} withDetails={withDetails} />
    </span>
  )

  return (
    <li
      data-slot="stage-path-item"
      data-state={state}
      data-pending={pending ? 'true' : undefined}
      aria-current={isCurrent ? 'step' : undefined}
      className={cn(
        'flex list-none',
        scrolls && 'min-w-18',
        !scrolls && !collapsed && 'min-w-0 flex-1 basis-0',
        !scrolls && collapsed && (isCurrent ? 'min-w-0 shrink grow-4 basis-auto' : 'min-w-4 flex-1 basis-0'),
      )}
    >
      <StageShell
        props={props}
        blocked={blocked}
        reasonId={reasonId}
        tooltip={tooltip}
        className={cn('flex w-full min-w-0 items-center', interactive && 'h-10 sm:h-8')}
      >
        {segment}
      </StageShell>
    </li>
  )
}

type MarkerProps = {
  state: StagePathStageState
  palette: Palette
  tone: ClosedTone
  size: StagePathSize
  icon: string | undefined
  blocked: boolean
  pending: boolean
}

const MARKER_UPCOMING_CLASS = 'border-2 border-border bg-background text-muted-foreground'
const MARKER_UNREACHED_CLASS = 'border border-dashed border-muted-foreground/50 text-muted-foreground'

function StageMarker({ state, palette, tone, size, icon, blocked, pending }: MarkerProps) {
  const StageIcon = resolveIcon(icon)
  const visual = resolveStageVisual(state, palette, tone, blocked)
  const isAnchor = state === 'current'
  const compact = size === 'compact'
  const glyphSize = compact || !isAnchor ? 'size-3' : 'size-4'
  let fill = visual.fill
  if (state === 'upcoming' && !blocked) fill = MARKER_UPCOMING_CLASS
  if (state === 'unreached' && !blocked) fill = MARKER_UNREACHED_CLASS
  if (state === 'done' && palette === 'open') fill = 'bg-status-info-bg'

  let glyph: React.ReactNode = null
  if (pending) glyph = <Spinner size="sm" className="size-3" />
  else if (visual.Glyph) glyph = <visual.Glyph aria-hidden="true" className={cn(glyphSize, visual.glyphClass)} />
  else if (StageIcon && isAnchor) glyph = <StageIcon aria-hidden="true" className={glyphSize} />
  else if (isAnchor) glyph = <span aria-hidden="true" className="size-2 rounded-full bg-current" />

  return (
    <span
      data-slot="stage-path-marker"
      data-state={state}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors',
        isAnchor ? (compact ? 'size-5' : 'size-6') : compact ? 'size-4' : 'size-5',
        pending ? 'bg-muted text-foreground' : fill,
      )}
    >
      {glyph}
    </span>
  )
}

type ConnectorKind = 'reached' | 'ahead' | 'unreached'

const CONNECTOR_REACHED_CLASS: Record<Palette, string> = {
  open: 'border-status-info-solid',
  success: 'border-status-success-icon',
  closed: 'border-muted-foreground/50',
}

function Connector({ kind, palette, vertical, className }: { kind: ConnectorKind; palette: Palette; vertical?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="stage-path-connector"
      data-reached={kind === 'reached' ? 'true' : 'false'}
      className={cn(
        vertical ? 'w-0 border-l-2' : 'h-0 border-t-2',
        kind === 'reached' && CONNECTOR_REACHED_CLASS[palette],
        kind === 'ahead' && 'border-border',
        kind === 'unreached' && 'border-dashed border-muted-foreground/40',
        className,
      )}
    />
  )
}

type MarkerStageProps = StageItemProps & {
  vertical: boolean
  hasConnector: boolean
  connector: ConnectorKind
}

function markerLabelClass(state: StagePathStageState, blocked: boolean): string {
  if (blocked) return 'text-muted-foreground/70'
  if (state === 'current' || state === 'ended' || state === 'done') return 'text-foreground'
  return 'text-muted-foreground'
}

function MarkerStage(props: MarkerStageProps) {
  const { stage, state, palette, tone, isCurrent, size, collapsed, scrolls, truncated, interactive, locked, pending, vertical, hasConnector, connector, t } = props
  const reasonId = React.useId()
  const blocked = interactive && stage.disabled === true
  const selectable = interactive && !blocked && !locked && !isCurrent
  const compact = size === 'compact'
  const marker = <StageMarker state={state} palette={palette} tone={tone} size={size} icon={stage.icon} blocked={blocked} pending={pending} />
  const labelTone = markerLabelClass(state, blocked)

  if (vertical) {
    const tooltip = buildStageTooltip({ stage, labelHidden: false, withDetails: false, reason: blocked ? stage.disabledReason : undefined })
    return (
      <li
        data-slot="stage-path-item"
        data-state={state}
        data-pending={pending ? 'true' : undefined}
        aria-current={isCurrent ? 'step' : undefined}
        className="flex list-none"
      >
        <StageShell
          props={props}
          blocked={blocked}
          reasonId={reasonId}
          tooltip={tooltip}
          className={cn(
            'flex w-full min-w-0 items-stretch gap-3 text-left',
            interactive && 'min-h-10 rounded-md px-2 transition-colors focus-visible:shadow-focus sm:min-h-8',
            selectable && 'hover:bg-muted',
          )}
        >
          <span className="flex w-6 shrink-0 flex-col items-center">
            <span className="flex h-8 shrink-0 items-center">{marker}</span>
            {hasConnector ? <Connector vertical kind={connector} palette={palette} className="min-h-2 flex-1" /> : null}
          </span>
          <span className={cn('flex min-w-0 flex-1 flex-col py-1', hasConnector && !compact && 'pb-4')}>
            <span className="flex min-w-0 items-baseline justify-between gap-3">
              <span
                data-slot="stage-path-label"
                data-stage-id={stage.id}
                className={cn('min-w-0 break-words leading-6', isCurrent && !compact ? 'text-base' : 'text-sm', labelTone)}
              >
                {stage.label}
              </span>
              {stage.meta ? (
                <span data-slot="stage-path-meta" className="shrink-0 text-sm leading-6 tabular-nums text-muted-foreground">
                  {stage.meta}
                </span>
              ) : null}
            </span>
            <span className="sr-only">{stateLabel(state, t)}</span>
            {stage.description && !compact ? (
              <span data-slot="stage-path-description" className="break-words text-sm leading-5 text-muted-foreground">
                {stage.description}
              </span>
            ) : null}
          </span>
        </StageShell>
      </li>
    )
  }

  const labelVisible = !collapsed
  const withDetails = !isCurrent || !props.detailsInSummary
  const tooltip = buildStageTooltip({
    stage,
    labelHidden: !labelVisible || truncated,
    withDetails,
    reason: blocked ? stage.disabledReason : undefined,
  })
  return (
    <li
      data-slot="stage-path-item"
      data-state={state}
      data-pending={pending ? 'true' : undefined}
      aria-current={isCurrent ? 'step' : undefined}
      className={cn('flex list-none', scrolls ? 'min-w-28' : hasConnector || !collapsed ? 'min-w-0 flex-1 basis-0' : 'flex-none')}
    >
      <StageShell
        props={props}
        blocked={blocked}
        reasonId={reasonId}
        tooltip={tooltip}
        className={cn(
          'flex w-full min-w-0 flex-col items-start gap-1 text-left',
          interactive && 'rounded-md focus-visible:shadow-focus',
        )}
      >
        <span className={cn('flex w-full items-center gap-2', interactive ? 'h-10 sm:h-8' : 'h-6')}>
          {marker}
          {hasConnector ? <Connector kind={connector} palette={palette} className="min-w-1 flex-1" /> : null}
        </span>
        {labelVisible ? (
          <span
            data-slot="stage-path-label"
            data-stage-id={stage.id}
            className={cn(
              'max-w-full pr-2 text-sm leading-5 transition-colors',
              scrolls ? 'whitespace-nowrap' : 'truncate',
              labelTone,
              selectable && 'group-hover:text-foreground',
            )}
          >
            {stage.label}
          </span>
        ) : null}
        <StageHiddenText props={props} labelVisible={labelVisible} withDetails={withDetails} />
      </StageShell>
    </li>
  )
}

function VerticalOutcome({ outcome, size, t }: { outcome: StagePathOutcome; size: StagePathSize; t: Translate }) {
  const Icon = OUTCOME_ICON[outcome.tone]
  const compact = size === 'compact'
  return (
    <li data-slot="stage-path-outcome" data-tone={outcome.tone} className="flex list-none gap-3">
      <span className="flex h-8 w-6 shrink-0 items-center justify-center">
        <span
          data-slot="stage-path-marker"
          data-state="outcome"
          className={cn('inline-flex items-center justify-center rounded-full', compact ? 'size-5' : 'size-6', OUTCOME_MARKER_CLASS[outcome.tone])}
        >
          <Icon aria-hidden="true" className={compact ? 'size-3' : 'size-4'} />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="sr-only">{t('ui.blocks.stagePath.outcome', 'Outcome')}</span>
        <span
          data-slot="stage-path-outcome-label"
          className={cn('break-words leading-6', compact ? 'text-sm' : 'text-base', OUTCOME_TEXT_CLASS[outcome.tone])}
        >
          {outcome.label}
        </span>
        {outcome.description && !compact ? (
          <span data-slot="stage-path-outcome-description" className="break-words text-sm leading-5 text-muted-foreground">
            {outcome.description}
          </span>
        ) : null}
      </span>
    </li>
  )
}

type SummaryProps = {
  id: string
  label: string | undefined
  description: string | undefined
  meta: string | undefined
  position: number
  total: number
  outcome: StagePathOutcome | undefined
  t: Translate
}

function OutcomeChip({ outcome, t }: { outcome: StagePathOutcome; t: Translate }) {
  const Icon = OUTCOME_ICON[outcome.tone]
  return (
    <Badge data-slot="stage-path-outcome" data-tone={outcome.tone} variant={outcome.tone} size="lg" className="shrink-0 gap-1 font-normal">
      <Icon aria-hidden="true" className="size-3" />
      <span className="sr-only">{t('ui.blocks.stagePath.outcome', 'Outcome')}</span>
      <span data-slot="stage-path-outcome-label">{outcome.label}</span>
    </Badge>
  )
}

function Summary({ id, label, description, meta, position, total, outcome, t }: SummaryProps) {
  const closed = outcome !== undefined && outcome.tone !== 'success'
  const hasText = Boolean(label || description || meta)
  const text = hasText ? (
    <p id={id} data-slot="stage-path-summary-text" className={cn('m-0 flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm leading-5', closed && 'basis-48')}>
      {label ? (
        <span data-slot="stage-path-summary-label" className="text-foreground">
          {label}
        </span>
      ) : null}
      {description ? (
        <span data-slot="stage-path-summary-description" className={cn('min-w-0 break-words', label ? 'text-muted-foreground' : 'text-foreground')}>
          {description}
        </span>
      ) : null}
      {meta ? (
        <span data-slot="stage-path-summary-meta" className="tabular-nums text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </p>
  ) : null
  const countClass = 'shrink-0 text-sm leading-5 tabular-nums text-muted-foreground'

  if (outcome && outcome.tone === 'success') {
    return (
      <div data-slot="stage-path-summary" className="flex min-w-0 items-center justify-between gap-4">
        {text}
        <span className="ml-auto flex shrink-0">
          <OutcomeChip outcome={outcome} t={t} />
        </span>
      </div>
    )
  }

  if (outcome) {
    return (
      <div data-slot="stage-path-summary" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <OutcomeChip outcome={outcome} t={t} />
        {text}
        <span data-slot="stage-path-summary-count" className={cn(countClass, 'ml-auto')}>
          {t('ui.blocks.stagePath.endedPosition', 'Ended at stage {current} of {total}', { current: position, total })}
        </span>
      </div>
    )
  }

  return (
    <div data-slot="stage-path-summary" className="flex min-w-0 items-baseline justify-between gap-4">
      {text}
      <span data-slot="stage-path-summary-count" className={countClass}>
        {t('ui.blocks.stagePath.position', 'Stage {current} of {total}', { current: position, total })}
      </span>
    </div>
  )
}

type SkeletonProps = {
  label: string
  count: number
  appearance: StagePathAppearance
  vertical: boolean
  size: StagePathSize
}

function StagePathSkeleton({ label, count, appearance, vertical, size }: SkeletonProps) {
  const rows = Array.from({ length: Math.min(Math.max(count, 2), SKELETON_MAX_ROWS) }, (_, index) => index)
  let body: React.ReactNode
  if (vertical) {
    body = (
      <div className="flex flex-col gap-4">
        {rows.map((index) => (
          <div key={index} className="flex min-w-0 items-center gap-3">
            <Skeleton shape="circle" className="size-6 shrink-0" />
            <Skeleton className="h-4 w-40 max-w-full" />
          </div>
        ))}
      </div>
    )
  } else if (appearance === 'markers') {
    body = (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          {rows.map((index) => (
            <div key={index} className="flex min-w-0 flex-1 items-center gap-2">
              <Skeleton shape="circle" className="size-6 shrink-0" />
              {index < rows.length - 1 ? <Skeleton className="h-1 flex-1" /> : null}
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-2">
        <Skeleton className={cn('w-full', size === 'compact' ? 'h-6' : 'h-8')} />
        {size === 'default' ? <Skeleton className="h-4 w-48 max-w-full" /> : null}
      </div>
    )
  }
  return (
    <div data-slot="stage-path-skeleton" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{body}</div>
    </div>
  )
}

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

export function StagePath(props: StagePathProps) {
  const t = useT()
  const {
    stages,
    currentStageId,
    completedStageIds,
    outcome,
    onStageSelect,
    pendingStageId,
    readOnly = false,
    orientation = 'horizontal',
    size = 'default',
    overflow = 'collapse',
    variant = 'plain',
    ariaLabel,
    status,
    errorMessage,
    onRetry,
    emptyState,
    className,
  } = props

  const isHorizontal = orientation === 'horizontal'
  const appearance: StagePathAppearance = isHorizontal ? (props.appearance ?? 'bar') : 'markers'
  const summaryId = React.useId()
  const frameRef = React.useRef<HTMLDivElement | null>(null)
  const listRef = React.useRef<HTMLOListElement | null>(null)
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const requiredWidthRef = React.useRef(0)
  const measuredSignatureRef = React.useRef('')
  const [collapsed, setCollapsed] = React.useState(false)
  const [truncatedKey, setTruncatedKey] = React.useState('')
  const [fades, setFades] = React.useState({ start: false, end: false })
  const [ownPendingId, setOwnPendingId] = React.useState<string | null>(null)
  const [focusStageId, setFocusStageId] = React.useState<string | null>(null)

  const isReady = status === undefined || status === 'ready'
  const collapses = isReady && isHorizontal && overflow === 'collapse'
  const scrolls = isReady && isHorizontal && overflow === 'scroll'
  const signature = `${appearance}|${size}|${stages.map((stage) => `${stage.id}:${stage.label}:${stage.icon ?? ''}`).join('|')}`

  React.useLayoutEffect(() => {
    if (!collapses && collapsed) setCollapsed(false)
    const frame = frameRef.current
    const list = listRef.current
    if (!isReady || !isHorizontal || !frame || !list) return
    const measure = () => {
      const labels = Array.from(list.querySelectorAll<HTMLElement>('[data-slot="stage-path-label"]'))
      const nextTruncatedKey = labels
        .filter((label) => label.scrollWidth > label.clientWidth + 1)
        .map((label) => label.dataset.stageId ?? '')
        .join('|')
      setTruncatedKey((current) => (current === nextTruncatedKey ? current : nextTruncatedKey))
      const width = frame.clientWidth
      if (!collapses || width <= 0) return
      if (collapsed) {
        if (measuredSignatureRef.current !== signature || width >= requiredWidthRef.current) setCollapsed(false)
        return
      }
      measuredSignatureRef.current = signature
      const rootFontPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || FALLBACK_ROOT_FONT_PX
      const chrome = appearance === 'bar' ? BAR_CHROME_PX : MARKERS_CHROME_PX
      const gap = appearance === 'bar' ? BAR_GAP_PX : MARKERS_GAP_PX
      const widest = labels.reduce((max, label) => Math.max(max, label.scrollWidth), 0) + chrome
      const segment = Math.min(Math.max(MIN_SEGMENT_REM * rootFontPx, widest), MAX_SEGMENT_REM * rootFontPx)
      const required = stages.length * segment + (stages.length - 1) * gap
      if (width < required) {
        requiredWidthRef.current = required
        setCollapsed(true)
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [isReady, isHorizontal, collapses, collapsed, signature, appearance, stages.length])

  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scrolls || !scroller) return
    const update = () => {
      const start = scroller.scrollLeft > 1
      const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
      setFades((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    const target = scroller.querySelector<HTMLElement>('li[aria-current="step"]')
    if (target) {
      const scrollerBox = scroller.getBoundingClientRect()
      const targetBox = target.getBoundingClientRect()
      const offset = targetBox.left - scrollerBox.left + scroller.scrollLeft
      scroller.scrollLeft = Math.max(0, offset - (scroller.clientWidth - targetBox.width) / 2)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [scrolls, currentStageId, signature])

  const rootProps = {
    'data-slot': 'stage-path',
    'data-orientation': orientation,
    'data-appearance': appearance,
    'data-size': size,
    'data-variant': variant,
  }

  if (status === 'error') {
    return (
      <div {...rootProps} data-status="error" className={className}>
        <ErrorMessage
          label={errorMessage ?? t('ui.blocks.stagePath.error', 'Could not load the stages')}
          className="max-w-xl rounded-md"
          action={
            onRetry ? (
              <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
                {t('ui.blocks.stagePath.retry', 'Try again')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const rootClass = cn('min-w-0', VARIANT_CLASS[variant], className)

  if (status === 'loading') {
    return (
      <div {...rootProps} data-status="loading" className={rootClass}>
        <StagePathSkeleton
          label={t('ui.blocks.stagePath.loading', 'Loading stages')}
          count={stages.length}
          appearance={appearance}
          vertical={!isHorizontal}
          size={size}
        />
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div {...rootProps} data-status="empty" className={rootClass}>
        {emptyState ?? (
          <EmptyState
            size="sm"
            icon={<Milestone aria-hidden="true" className="size-5" />}
            title={t('ui.blocks.stagePath.empty', 'No stages yet')}
            description={t('ui.blocks.stagePath.emptyDescription', 'Stages show up here once a process is assigned.')}
            className="items-start px-0 text-left"
          />
        )}
      </div>
    )
  }

  const states = resolveStageStates(stages, currentStageId, completedStageIds, outcome)
  const palette = resolvePalette(outcome)
  const tone = closedTone(outcome)
  const currentIndex = Math.max(0, stages.findIndex((stage) => stage.id === currentStageId))
  const currentStage = stages[currentIndex]
  const interactive = typeof onStageSelect === 'function' && !readOnly
  const pendingId = pendingStageId ?? ownPendingId
  const locked = pendingId !== null && pendingId !== undefined
  const tabStopId = focusStageId !== null && stages.some((stage) => stage.id === focusStageId) ? focusStageId : currentStageId
  const isBar = appearance === 'bar'
  const truncatedIds = new Set(truncatedKey ? truncatedKey.split('|') : [])
  const summaryVisible = isHorizontal && (size === 'default' || collapsed || outcome !== undefined)
  const summaryShowsLabel = !isBar && collapsed && outcome?.tone !== 'success'
  const summaryDescription = size === 'default' ? (outcome ? outcome.description : currentStage?.description) : undefined
  const summaryMeta = outcome ? undefined : currentStage?.meta
  const summaryHasText = summaryVisible && (summaryShowsLabel || Boolean(summaryDescription) || Boolean(summaryMeta))

  const handleSelect = (stage: StagePathStage) => {
    if (!onStageSelect || stage.disabled === true || locked || stage.id === currentStageId) return
    const result = onStageSelect(stage.id)
    if (!isPromise(result)) return
    setOwnPendingId(stage.id)
    const clear = () => setOwnPendingId((current) => (current === stage.id ? null : current))
    result.then(clear, clear)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLOListElement>) => {
    if (!interactive) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button[data-slot="stage-path-stage"]'))
    const index = buttons.findIndex((button) => button === document.activeElement)
    if (index < 0) return
    let nextIndex = -1
    if (NEXT_KEYS.has(event.key)) nextIndex = Math.min(buttons.length - 1, index + 1)
    else if (PREVIOUS_KEYS.has(event.key)) nextIndex = Math.max(0, index - 1)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = buttons.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    buttons[nextIndex]?.focus()
  }

  const connectorKind = (index: number): ConnectorKind => {
    const isLast = index === stages.length - 1
    if (isLast) return states[index] === 'unreached' ? 'unreached' : 'reached'
    if (states[index + 1] === 'unreached') return 'unreached'
    return states[index] === 'done' && isReached(states[index + 1]) ? 'reached' : 'ahead'
  }

  const label = ariaLabel ?? t('ui.blocks.stagePath.label', 'Stages')
  const list = (
    <ol
      ref={listRef}
      data-slot="stage-path-list"
      data-collapsed={collapsed ? 'true' : undefined}
      aria-label={label}
      className={cn(
        'm-0 list-none p-0',
        !isHorizontal && 'flex flex-col',
        isHorizontal && !scrolls && 'flex w-full',
        isHorizontal && scrolls && 'grid w-max min-w-full auto-cols-fr grid-flow-col',
        isHorizontal && (isBar ? 'gap-px' : 'gap-2'),
      )}
      onKeyDown={handleKeyDown}
    >
      {stages.map((stage, index) => {
        const shared: StageItemProps = {
          stage,
          state: states[index] ?? 'upcoming',
          palette,
          tone,
          index,
          count: stages.length,
          isCurrent: stage.id === currentStageId,
          size,
          collapsed,
          scrolls,
          truncated: truncatedIds.has(stage.id),
          detailsInSummary: summaryVisible && !outcome,
          summaryId: summaryHasText ? summaryId : undefined,
          interactive,
          locked,
          pending: pendingId === stage.id,
          tabStop: stage.id === tabStopId,
          onSelect: handleSelect,
          onFocusStage: setFocusStageId,
          t,
        }
        if (isBar) return <BarStage key={stage.id} {...shared} />
        const isLast = index === stages.length - 1
        return (
          <MarkerStage
            key={stage.id}
            {...shared}
            vertical={!isHorizontal}
            hasConnector={!isLast || (!isHorizontal && outcome !== undefined)}
            connector={connectorKind(index)}
          />
        )
      })}
      {outcome && !isHorizontal ? <VerticalOutcome outcome={outcome} size={size} t={t} /> : null}
    </ol>
  )

  let track: React.ReactNode = list
  if (scrolls) {
    const scrollable = fades.start || fades.end
    track = (
      <div data-slot="stage-path-scroll" className="relative -m-1 min-w-0">
        <div
          ref={scrollerRef}
          data-slot="stage-path-scroller"
          role={scrollable && !interactive ? 'group' : undefined}
          aria-label={scrollable && !interactive ? label : undefined}
          tabIndex={scrollable && !interactive ? 0 : undefined}
          className="relative overflow-x-auto rounded-md p-1 outline-none focus-visible:shadow-focus"
        >
          {list}
        </div>
        {fades.start ? (
          <span
            aria-hidden="true"
            data-slot="stage-path-fade-start"
            className={cn('pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r to-transparent', FADE_FROM_CLASS[variant])}
          />
        ) : null}
        {fades.end ? (
          <span
            aria-hidden="true"
            data-slot="stage-path-fade-end"
            className={cn('pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l to-transparent', FADE_FROM_CLASS[variant])}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div {...rootProps} data-closed={outcome ? 'true' : undefined} className={rootClass}>
      <div ref={frameRef} data-slot="stage-path-frame" className="flex min-w-0 flex-col gap-2">
        {track}
        {summaryVisible && currentStage ? (
          <Summary
            id={summaryId}
            label={summaryShowsLabel ? currentStage.label : undefined}
            description={summaryDescription}
            meta={summaryMeta}
            position={currentIndex + 1}
            total={stages.length}
            outcome={outcome}
            t={t}
          />
        ) : null}
      </div>
    </div>
  )
}
