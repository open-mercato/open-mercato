import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '../../primitives/button'
import {
  getMessagePriorityLabel,
  getMessagePriorityOptions,
  getNextMessagePriority,
  getPreviousMessagePriority,
  type MessagePriority,
} from './message-priority'

type MessagePrioritySelectorProps = {
  value: MessagePriority
  onChange: (value: MessagePriority) => void
  t: (key: string, fallback?: string) => string
  className?: string
}

export function MessagePrioritySelector({
  value,
  onChange,
  t,
  className,
}: MessagePrioritySelectorProps) {
  const options = React.useMemo(() => getMessagePriorityOptions(t), [t])
  const selectedLabel = React.useMemo(() => getMessagePriorityLabel(value, t), [t, value])
  const selectorLabel = t('messages.priority', 'Priority')

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      onChange(getNextMessagePriority(value))
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      onChange(getPreviousMessagePriority(value))
    }
  }, [onChange, value])

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="inline-flex w-full items-center gap-1 rounded-md border bg-background p-1 sm:w-auto"
        role="radiogroup"
        aria-label={selectorLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {options.map((option) => {
          const Icon = option.icon
          const isSelected = value === option.value
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={isSelected ? 'outline' : 'ghost'}
              role="radio"
              aria-checked={isSelected}
              aria-label={option.label}
              title={option.label}
              className={cn(
                'h-7 gap-1 px-2 text-xs sm:text-sm',
                isSelected ? 'ring-1 ring-primary/40' : null,
              )}
              onClick={() => onChange(option.value)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
            </Button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{selectedLabel}</p>
    </div>
  )
}
