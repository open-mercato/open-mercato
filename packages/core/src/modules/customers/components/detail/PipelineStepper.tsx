"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { isTerminalPipelineOutcomeLabel } from './pipelineStageUtils'

type PipelineStageInfo = {
  id: string
  label: string
  order: number
  color?: string | null
  icon?: string | null
}

type StageTransitionInfo = {
  stageId: string
  stageLabel: string
  stageOrder: number
  transitionedAt: string
}

type PipelineStepperProps = {
  stages: PipelineStageInfo[]
  transitions: StageTransitionInfo[]
  currentStageId: string | null
  pipelineName?: string | null
  closureOutcome?: 'won' | 'lost' | null
  /** Moves the deal to the clicked stage; without it the path is read-only. */
  onStageChange?: (stageId: string) => Promise<void> | void
  stageChangeDisabled?: boolean
}

function isTerminalOutcomeStage(stage: PipelineStageInfo): boolean {
  return isTerminalPipelineOutcomeLabel(stage.label)
}

function formatTransitionDate(value: string, t: ReturnType<typeof useT>): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('customers.deals.detail.pipeline.current', 'current')
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatStageSubtitle(
  transition: StageTransitionInfo | null,
  isCurrent: boolean,
  t: ReturnType<typeof useT>,
): string | null {
  if (transition && isCurrent) {
    return t('customers.deals.detail.pipeline.currentWithDate', '{{date}}, {{state}}', {
      date: formatTransitionDate(transition.transitionedAt, t),
      state: t('customers.deals.detail.pipeline.current', 'current'),
    })
  }
  if (transition) return formatTransitionDate(transition.transitionedAt, t)
  if (isCurrent) return t('customers.deals.detail.pipeline.current', 'current')
  return null
}

export function PipelineStepper({
  stages,
  transitions,
  currentStageId,
  pipelineName,
  closureOutcome = null,
  onStageChange,
  stageChangeDisabled = false,
}: PipelineStepperProps) {
  const t = useT()
  const allStages = React.useMemo(
    () => [...stages].sort((left, right) => left.order - right.order),
    [stages],
  )
  const sortedStages = React.useMemo(
    () => allStages.filter((stage) => !isTerminalOutcomeStage(stage)),
    [allStages],
  )
  const transitionByStageId = React.useMemo(
    () => new Map(transitions.map((transition) => [transition.stageId, transition])),
    [transitions],
  )
  const lastVisibleTransitionStage = React.useMemo(() => {
    const transitionedStageIds = new Set(transitions.map((transition) => transition.stageId))
    const visibleTransitionStages = sortedStages.filter((stage) => transitionedStageIds.has(stage.id))
    return visibleTransitionStages[visibleTransitionStages.length - 1] ?? null
  }, [sortedStages, transitions])
  const currentVisibleStage = React.useMemo(() => {
    const exactVisibleStage = sortedStages.find((stage) => stage.id === currentStageId) ?? null
    if (exactVisibleStage) return exactVisibleStage
    const currentStage = allStages.find((stage) => stage.id === currentStageId) ?? null
    if (currentStage && isTerminalOutcomeStage(currentStage)) {
      const earlierVisibleStages = sortedStages.filter((stage) => stage.order < currentStage.order)
      return earlierVisibleStages[earlierVisibleStages.length - 1] ?? sortedStages[sortedStages.length - 1] ?? null
    }
    return lastVisibleTransitionStage
  }, [allStages, currentStageId, lastVisibleTransitionStage, sortedStages])
  const currentIndex = currentVisibleStage ? sortedStages.findIndex((stage) => stage.id === currentVisibleStage.id) : -1
  const compactStage = currentVisibleStage ?? sortedStages[0] ?? null
  const renderClosedProgress = closureOutcome !== null
  const canSelectStages = !renderClosedProgress && typeof onStageChange === 'function' && !stageChangeDisabled
  const progressValue = currentIndex >= 0 ? currentIndex + 1 : 0
  const progressValueText = renderClosedProgress
    ? closureOutcome === 'won'
      ? t('customers.deals.detail.pipeline.ariaClosedWon', 'Pipeline closed — deal won.')
      : t('customers.deals.detail.pipeline.ariaClosedLost', 'Pipeline closed — deal lost.')
    : t('customers.deals.detail.pipeline.ariaValueText', 'Stage {{current}} of {{total}}: {{label}}', {
        current: progressValue,
        total: sortedStages.length,
        label: currentVisibleStage?.label ?? t('customers.deals.detail.pipeline.noCurrent', 'no current stage'),
      })
  const progressLabel = pipelineName
    ? t('customers.deals.detail.pipeline.ariaLabelNamed', 'Pipeline progress — {{name}}', { name: pipelineName })
    : t('customers.deals.detail.pipeline.ariaLabel', 'Pipeline progress')

  const outcomeSegment = renderClosedProgress ? (
    <div className="flex w-full min-w-0 flex-col gap-2.5 text-left">
      <span
        aria-hidden="true"
        className={cn(
          'block h-1.5 rounded-full',
          closureOutcome === 'won' ? 'bg-status-success-icon' : 'bg-status-error-icon',
        )}
      />
      <span className="block truncate text-xs leading-tight text-foreground">
        {closureOutcome === 'won'
          ? t('customers.deals.detail.badge.won', 'Won')
          : t('customers.deals.detail.badge.lost', 'Lost')}
      </span>
    </div>
  ) : null

  if (!sortedStages.length) return outcomeSegment

  return (
    <div>
      <div
        role="progressbar"
        aria-label={progressLabel}
        aria-valuemin={0}
        aria-valuemax={sortedStages.length}
        aria-valuenow={progressValue}
        aria-valuetext={progressValueText}
        className="sr-only"
      />

      <div className="sm:hidden">
        {compactStage ? (
          <div
            className="rounded-md bg-muted px-3 py-2.5"
            aria-current={!renderClosedProgress && compactStage.id === currentVisibleStage?.id ? 'step' : undefined}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex size-7 items-center justify-center rounded-full border-2 bg-background text-xs text-foreground',
                  renderClosedProgress ? 'border-status-success-icon bg-status-success-icon text-white' : 'border-accent-indigo',
                )}
              >
                {renderClosedProgress ? (
                  <Check className="size-3.5 stroke-[2.5]" />
                ) : (
                  <span className="font-medium leading-none">{(currentIndex >= 0 ? currentIndex : 0) + 1}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{compactStage.label}</div>
                <div className="min-h-4 text-xs text-muted-foreground">
                  {formatStageSubtitle(transitionByStageId.get(compactStage.id) ?? null, !renderClosedProgress, t)}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {outcomeSegment ? <div className="mt-3">{outcomeSegment}</div> : null}
      </div>

      <div className="hidden sm:block">
        <ol className="flex min-w-0 gap-1" aria-label={progressLabel}>
          {sortedStages.map((stage, index) => {
            const transition = transitionByStageId.get(stage.id) ?? null
            const isCurrent = !renderClosedProgress && currentVisibleStage?.id === stage.id
            const isCompleted = renderClosedProgress
              ? currentIndex >= 0 && index <= currentIndex
              : !isCurrent && (transition !== null || (currentIndex >= 0 && index < currentIndex))
            const selectable = canSelectStages && !isCurrent
            const segmentClassName = 'flex w-full min-w-0 flex-col gap-2.5 rounded-sm text-left'
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'block h-1.5 rounded-full transition-colors',
                    isCurrent && 'bg-accent-indigo',
                    isCompleted && !isCurrent && 'bg-status-success-icon',
                    !isCurrent && !isCompleted && 'bg-border',
                    selectable && 'group-hover:bg-muted-foreground',
                  )}
                />
                <span
                  className={cn(
                    'block truncate text-xs leading-tight',
                    isCurrent ? 'text-foreground' : 'text-muted-foreground',
                    selectable && 'group-hover:text-foreground',
                  )}
                >
                  {stage.label}
                </span>
              </>
            )
            return (
              <li key={stage.id} className="min-w-0 flex-1" aria-current={isCurrent ? 'step' : undefined}>
                {selectable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      segmentClassName,
                      'group h-auto items-stretch justify-start whitespace-normal p-0 font-normal hover:bg-transparent dark:hover:bg-transparent',
                    )}
                    onClick={() => {
                      void onStageChange?.(stage.id)
                    }}
                  >
                    {content}
                  </Button>
                ) : (
                  <div className={segmentClassName}>{content}</div>
                )}
              </li>
            )
          })}
          {outcomeSegment ? <li className="min-w-0 flex-1">{outcomeSegment}</li> : null}
        </ol>
      </div>
    </div>
  )
}
