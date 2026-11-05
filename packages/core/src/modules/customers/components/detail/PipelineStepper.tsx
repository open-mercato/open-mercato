"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
  footer?: React.ReactNode
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
): string {
  if (transition && isCurrent) {
    return t('customers.deals.detail.pipeline.currentWithDate', '{{date}} · {{state}}', {
      date: formatTransitionDate(transition.transitionedAt, t),
      state: t('customers.deals.detail.pipeline.current', 'current'),
    })
  }
  if (transition) return formatTransitionDate(transition.transitionedAt, t)
  if (isCurrent) return t('customers.deals.detail.pipeline.current', 'current')
  return '—'
}

export function PipelineStepper({
  stages,
  transitions,
  currentStageId,
  pipelineName,
  closureOutcome = null,
  footer = null,
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

  if (!sortedStages.length) return null

  return (
    <div
      className="rounded-lg border border-border bg-card px-5 py-3.5 sm:px-6"
      role="progressbar"
      aria-label={progressLabel}
      aria-valuemin={0}
      aria-valuemax={sortedStages.length}
      aria-valuenow={progressValue}
      aria-valuetext={progressValueText}
    >
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs leading-none">
        <p className="font-semibold uppercase tracking-[0.02em] text-muted-foreground">
          {t('customers.deals.detail.pipeline.label', 'Pipeline stages')}
        </p>
        <span className="text-border">·</span>
        <p className="font-normal text-muted-foreground">
          {t('customers.deals.detail.pipeline.stageOf', 'Stage {{current}} of {{total}}', {
            current: currentIndex >= 0 ? currentIndex + 1 : 0,
            total: sortedStages.length,
          })}
        </p>
        <span className="text-border">·</span>
        <p className="font-normal text-muted-foreground">
          {pipelineName ?? t('customers.deals.detail.pipeline.defaultName', 'Current pipeline')}
        </p>
      </div>

      <div className="space-y-4 sm:hidden">
        {compactStage ? (
          <div
            className="rounded-lg border border-border bg-muted/20 px-4 py-4"
            aria-current={!renderClosedProgress && compactStage.id === currentVisibleStage?.id ? 'step' : undefined}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex size-9 items-center justify-center rounded-full border-2 bg-background text-foreground',
                  renderClosedProgress ? 'border-status-success-icon bg-status-success-icon text-white' : 'border-foreground',
                )}
              >
                {renderClosedProgress ? (
                  <Check className="size-4 stroke-[2.5]" />
                ) : (
                  <span className="text-sm font-semibold leading-none">
                    {(currentIndex >= 0 ? currentIndex : 0) + 1}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{compactStage.label}</div>
                <div className="text-xs text-muted-foreground">
                  {formatStageSubtitle(transitionByStageId.get(compactStage.id) ?? null, !renderClosedProgress, t)}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="hidden min-h-[115px] items-start sm:flex">
        {sortedStages.map((stage, index) => {
          const transition = transitionByStageId.get(stage.id) ?? null
          const isCurrent = !renderClosedProgress && currentVisibleStage?.id === stage.id
          const isCompleted = renderClosedProgress
            ? currentIndex >= 0 && index <= currentIndex
            : !isCurrent && (transition !== null || (currentIndex >= 0 && index < currentIndex))
          const isFuture = !isCurrent && !isCompleted
          const isFirst = index === 0
          const isLast = index === sortedStages.length - 1
          const beforeFilled = renderClosedProgress ? index <= currentIndex : index <= currentIndex
          const afterFilled = renderClosedProgress ? index < currentIndex : index < currentIndex

          return (
            <div
              key={stage.id}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="flex w-full items-center" aria-hidden="true">
                <div
                  className={cn(
                    'h-[2px] flex-1',
                    isFirst ? 'bg-transparent' : beforeFilled ? 'bg-status-success-icon' : 'bg-border/60',
                  )}
                />
                <div
                  className={cn(
                    'mx-0 flex size-9 items-center justify-center rounded-full border-2 text-sm leading-none transition-colors',
                    isCurrent && 'border-foreground bg-background font-bold text-foreground',
                    isCompleted && !isCurrent && 'border-status-success-icon bg-status-success-icon text-white',
                    isFuture && 'border-border bg-background font-medium text-muted-foreground',
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-4 stroke-[2.5]" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <div
                  className={cn(
                    'h-[2px] flex-1',
                    isLast ? 'bg-transparent' : afterFilled ? 'bg-status-success-icon' : 'bg-border/60',
                  )}
                />
              </div>
              <div className="flex max-w-[12rem] flex-col items-center gap-0.5 text-center">
                <div
                  className={cn(
                    'text-xs leading-[1.2]',
                    isCurrent ? 'font-bold text-foreground' : isFuture ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground',
                  )}
                >
                  {stage.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatStageSubtitle(transition, isCurrent, t)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {footer ? (
        <div className="mt-5 border-t border-border/80 pt-4">
          {footer}
        </div>
      ) : null}
    </div>
  )
}
