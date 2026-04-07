'use client'
import * as React from 'react'
import { Check, X, Trophy, Lock } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export interface PipelineStage {
  id: string
  label: string
  order: number
}

interface StageProgressBarProps {
  stages: PipelineStage[]
  currentStageId: string | null
  closureOutcome?: 'won' | 'lost' | null
  onStageClick: (stageId: string) => void
  onWon: () => void
  onLost: () => void
  disabled?: boolean
}

export function StageProgressBar({
  stages,
  currentStageId,
  closureOutcome,
  onStageClick,
  onWon,
  onLost,
  disabled = false,
}: StageProgressBarProps) {
  const t = useT()
  const sorted = React.useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages],
  )
  const currentIndex = sorted.findIndex((s) => s.id === currentStageId)
  const isClosed = closureOutcome === 'won' || closureOutcome === 'lost'

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent, index: number) => {
      if (isClosed || disabled) return
      let targetIndex = -1
      if (event.key === 'ArrowRight') targetIndex = Math.min(index + 1, sorted.length - 1)
      if (event.key === 'ArrowLeft') targetIndex = Math.max(index - 1, 0)
      if (targetIndex >= 0 && targetIndex !== index) {
        event.preventDefault()
        onStageClick(sorted[targetIndex].id)
      }
    },
    [isClosed, disabled, sorted, onStageClick],
  )

  if (sorted.length === 0) return null

  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-1"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={sorted.length}
        aria-valuetext={
          isClosed
            ? t(`sales.stageBar.closed.${closureOutcome}`, closureOutcome === 'won' ? 'Won' : 'Lost')
            : sorted[currentIndex]?.label ?? ''
        }
      >
        {sorted.map((stage, index) => {
          const isCompleted = currentIndex > index
          const isCurrent = currentIndex === index
          const isUpcoming = currentIndex < index

          return (
            <React.Fragment key={stage.id}>
              {index > 0 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 min-w-[12px]',
                    isCompleted || isCurrent ? 'bg-primary' : 'bg-muted',
                    isClosed && closureOutcome === 'lost' && 'bg-muted',
                    isClosed && closureOutcome === 'won' && 'bg-green-500',
                  )}
                />
              )}
              <button
                type="button"
                onClick={() => !isClosed && !disabled && onStageClick(stage.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                disabled={isClosed || disabled}
                className={cn(
                  'flex flex-col items-center gap-1 group min-w-0',
                  !isClosed && !disabled && 'cursor-pointer',
                  (isClosed || disabled) && 'cursor-default',
                )}
                aria-label={`${stage.label} — ${isCompleted ? t('sales.stageBar.completed', 'Completed') : isCurrent ? t('sales.stageBar.current', 'Current') : t('sales.stageBar.upcoming', 'Upcoming')}`}
                tabIndex={isCurrent ? 0 : -1}
              >
                <div
                  className={cn(
                    'flex items-center justify-center size-7 rounded-full border-2 motion-safe:transition-colors',
                    isCompleted && !isClosed && 'border-primary bg-primary text-primary-foreground',
                    isCurrent && !isClosed && 'border-primary bg-primary/10 text-primary',
                    isUpcoming && !isClosed && 'border-muted bg-background text-muted-foreground',
                    isClosed && closureOutcome === 'won' && 'border-green-500 bg-green-500/10 text-green-600',
                    isClosed && closureOutcome === 'lost' && 'border-muted bg-muted/30 text-muted-foreground',
                    !isClosed && !disabled && 'group-hover:border-primary/70',
                  )}
                >
                  {isClosed && closureOutcome === 'won' ? (
                    <Trophy className="size-3.5" />
                  ) : isClosed && closureOutcome === 'lost' ? (
                    <Lock className="size-3" />
                  ) : isCompleted ? (
                    <Check className="size-3.5" />
                  ) : isCurrent ? (
                    <div className="size-2 rounded-full bg-primary" />
                  ) : (
                    <div className="size-2 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-[10px] leading-tight text-center max-w-[80px] truncate',
                    isCurrent && !isClosed && 'font-medium text-foreground',
                    isCompleted && !isClosed && 'text-muted-foreground',
                    isUpcoming && !isClosed && 'text-muted-foreground/70',
                    isClosed && 'text-muted-foreground',
                  )}
                  title={stage.label}
                >
                  {stage.label}
                </span>
              </button>
            </React.Fragment>
          )
        })}
      </div>

      {!isClosed && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onWon}
            disabled={disabled}
            className="text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300"
          >
            <Check className="size-3.5 mr-1" />
            {t('sales.stageBar.won', 'Won')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLost}
            disabled={disabled}
            className="text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/40"
          >
            <X className="size-3.5 mr-1" />
            {t('sales.stageBar.lost', 'Lost')}
          </Button>
        </div>
      )}

      {isClosed && (
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            closureOutcome === 'won' && 'bg-green-100 text-green-700',
            closureOutcome === 'lost' && 'bg-destructive/10 text-destructive',
          )}
        >
          {closureOutcome === 'won' ? (
            <><Trophy className="size-3" /> {t('sales.stageBar.closedWon', 'Deal Won')}</>
          ) : (
            <><X className="size-3" /> {t('sales.stageBar.closedLost', 'Deal Lost')}</>
          )}
        </div>
      )}
    </div>
  )
}
