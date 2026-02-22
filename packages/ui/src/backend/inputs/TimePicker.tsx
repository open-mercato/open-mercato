"use client"

import * as React from 'react'
import { ClockIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { TimeInput } from './TimeInput'

export type TimePickerProps = {
  value?: string | null
  onChange: (time: string | null) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  className?: string
  minuteStep?: number
  showNowButton?: boolean
  showClearButton?: boolean
}

function currentHHMM(): string {
  const now = new Date()
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

export function TimePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  readOnly = false,
  className,
  minuteStep = 1,
  showNowButton = true,
  showClearButton = true,
}: TimePickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const placeholderText = placeholder ?? t('ui.timePicker.placeholder', 'Pick a time')
  const nowText = t('ui.timePicker.nowButton', 'Now')
  const clearText = t('ui.dateTimePicker.clearButton', 'Clear')

  const handleTimeChange = React.useCallback(
    (time: string) => {
      onChange(time)
    },
    [onChange]
  )

  const handleNow = React.useCallback(() => {
    onChange(currentHHMM())
    setOpen(false)
  }, [onChange])

  const handleClear = React.useCallback(() => {
    onChange(null)
    setOpen(false)
  }, [onChange])

  const isInteractive = !disabled && !readOnly

  return (
    <Popover open={open} onOpenChange={isInteractive ? setOpen : undefined}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-crud-focus-target=""
          disabled={disabled}
          aria-haspopup="dialog"
          className={cn(
            'w-full h-9 flex items-center gap-2 rounded border px-3 text-sm text-left',
            'bg-background transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
            'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed',
            readOnly && 'cursor-default opacity-70',
            !value && 'text-muted-foreground',
            className
          )}
          onClick={isInteractive ? undefined : (e) => e.preventDefault()}
        >
          <ClockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{value ?? placeholderText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-3 w-auto min-w-[180px]">
        <TimeInput
          value={value}
          onChange={handleTimeChange}
          minuteStep={minuteStep}
        />
        {(showNowButton || showClearButton) && (
          <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t">
            {showNowButton && (
              <button
                type="button"
                onClick={handleNow}
                className="text-sm text-primary hover:underline focus:outline-none"
              >
                {nowText}
              </button>
            )}
            {showClearButton && (
              <button
                type="button"
                onClick={handleClear}
                className="text-sm text-muted-foreground hover:text-foreground hover:underline focus:outline-none ml-auto"
              >
                {clearText}
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
