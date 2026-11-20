"use client"

import * as React from 'react'
import { Check, ChevronDown, Workflow } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { isTerminalPipelineOutcomeLabel } from './pipelineStageUtils'

export type StageSelectOption = {
  id: string
  label: string
  order: number
}

type StageSelectMenuProps = {
  stages: StageSelectOption[]
  currentStageId: string | null
  onStageChange: (stageId: string) => Promise<void> | void
  disabled?: boolean
  isSaving?: boolean
  /** Puts the current stage label on the trigger instead of the generic action label. */
  showCurrentStage?: boolean
  className?: string
}

/**
 * Compact stage picker: a popover listing the non-terminal stages of the pipeline.
 * Used where the stage strip has no room for clickable segments (narrow screens)
 * and by the deprecated `DealDetailHeader` stage inputs.
 */
export function StageSelectMenu({
  stages,
  currentStageId,
  onStageChange,
  disabled = false,
  isSaving = false,
  showCurrentStage = false,
  className,
}: StageSelectMenuProps) {
  const t = useT()
  const sortedStages = React.useMemo(
    () =>
      [...stages]
        .filter((stage) => !isTerminalPipelineOutcomeLabel(stage.label))
        .sort((left, right) => left.order - right.order),
    [stages],
  )
  const currentStage = React.useMemo(
    () => sortedStages.find((stage) => stage.id === currentStageId) ?? null,
    [currentStageId, sortedStages],
  )

  if (!sortedStages.length) return null

  const actionLabel = t('customers.deals.detail.actions.moveStage', 'Move stage')
  const triggerLabel = showCurrentStage && currentStage ? currentStage.label : actionLabel

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || isSaving}
          className={cn('h-8 max-w-56 rounded-md px-3', className)}
        >
          <Workflow className="size-4" />
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="flex flex-col">
          {sortedStages.map((stage) => {
            const isCurrent = stage.id === currentStageId
            return (
              <PopoverClose asChild key={stage.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isCurrent}
                  aria-current={isCurrent ? 'true' : undefined}
                  className="w-full justify-between"
                  onClick={() => {
                    if (!isCurrent) void onStageChange(stage.id)
                  }}
                >
                  <span className="min-w-0 truncate">{stage.label}</span>
                  {isCurrent ? <Check className="size-4" /> : null}
                </Button>
              </PopoverClose>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
