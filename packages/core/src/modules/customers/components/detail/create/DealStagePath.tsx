"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { isTerminalPipelineOutcomeLabel } from '../pipelineStageUtils'
import type { PipelineStageOption } from './useDealPipelines'

export type DealStagePathProps = {
  stages: PipelineStageOption[]
  value: string | null
  onChange: (stageId: string) => void
  disabled?: boolean
  /** Accessible name of the group, usually the pipeline name. */
  label: string
}

/**
 * The stages a new deal can sit on, in pipeline order. Won, Lost and Stalled are outcomes rather
 * than steps, so they are left out, unless one is already selected: a submitted stage is always shown.
 */
export function selectableDealStages(stages: PipelineStageOption[], selectedId?: string | null): PipelineStageOption[] {
  return [...stages]
    .sort((left, right) => left.order - right.order)
    .filter((stage) => stage.id === selectedId || !isTerminalPipelineOutcomeLabel(stage.label))
}

/**
 * Stage picker for a new deal: one numbered pill per stage in pipeline order. Stages before
 * the picked one read as done (check), the picked one is filled, the rest wait in muted
 * outline. Pills wrap instead of truncating so long stage names stay whole.
 */
export function DealStagePath({ stages, value, onChange, disabled = false, label }: DealStagePathProps) {
  const orderedStages = React.useMemo(() => selectableDealStages(stages, value), [stages, value])
  const currentIndex = orderedStages.findIndex((stage) => stage.id === value)
  if (!orderedStages.length) return null

  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label={label}>
      {orderedStages.map((stage, index) => {
        const isCurrent = index === currentIndex
        const isCompleted = currentIndex >= 0 && index < currentIndex
        return (
          <li key={stage.id} className="flex items-center" aria-current={isCurrent ? 'step' : undefined}>
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              aria-pressed={isCurrent}
              onClick={() => {
                if (!isCurrent) onChange(stage.id)
              }}
              className={cn(
                'h-auto min-h-9 whitespace-normal rounded-full border py-1.5 pl-1.5 pr-3.5 font-normal shadow-none transition-colors',
                isCurrent && 'border-status-info-border bg-status-info-bg text-status-info-text hover:bg-status-info-bg',
                isCompleted && 'border-status-success-border bg-status-success-bg text-status-success-text hover:bg-status-success-bg/70',
                !isCurrent && !isCompleted && 'border-border bg-background text-muted-foreground hover:border-accent-indigo/60 hover:bg-background hover:text-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums',
                  isCurrent && 'bg-status-info-bg text-status-info-text',
                  isCompleted && 'bg-status-success-icon text-status-success-bg',
                  !isCurrent && !isCompleted && 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className="size-3.5 stroke-[2.5]" /> : index + 1}
              </span>
              <span className="text-left leading-tight">{stage.label}</span>
            </Button>
          </li>
        )
      })}
    </ol>
  )
}

export default DealStagePath
