"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '../../primitives/input'

export type TimeInputProps = {
  value?: string | null
  onChange: (time: string) => void
  disabled?: boolean
  className?: string
  minuteStep?: number
  hourLabel?: string
  minuteLabel?: string
}

function padTwo(n: number): string {
  return String(n).padStart(2, '0')
}

function parseTime(value: string | null | undefined): { hour: number; minute: number } {
  if (!value) return { hour: 0, minute: 0 }
  const parts = value.split(':')
  const hour = parseInt(parts[0] ?? '0', 10)
  const minute = parseInt(parts[1] ?? '0', 10)
  return {
    hour: isNaN(hour) ? 0 : Math.max(0, Math.min(23, hour)),
    minute: isNaN(minute) ? 0 : Math.max(0, Math.min(59, minute)),
  }
}

function snapMinute(minute: number, step: number): number {
  if (step <= 1) return minute
  return Math.round(minute / step) * step % 60
}

export function TimeInput({
  value,
  onChange,
  disabled = false,
  className,
  minuteStep = 1,
  hourLabel: hourLabelProp,
  minuteLabel: minuteLabelProp,
}: TimeInputProps) {
  const t = useT()
  const hourLabel = hourLabelProp ?? t('ui.timePicker.hourLabel', 'Hour')
  const minuteLabel = minuteLabelProp ?? t('ui.timePicker.minuteLabel', 'Minute')

  const { hour, minute } = parseTime(value)

  const emitChange = React.useCallback(
    (nextHour: number, nextMinute: number) => {
      onChange(`${padTwo(nextHour)}:${padTwo(nextMinute)}`)
    },
    [onChange]
  )

  const handleHourKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        emitChange((hour + 1) % 24, minute)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        emitChange((hour + 23) % 24, minute)
      }
    },
    [disabled, emitChange, hour, minute]
  )

  const handleMinuteKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const step = minuteStep > 1 ? minuteStep : 1
        emitChange(hour, (minute + step) % 60)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const step = minuteStep > 1 ? minuteStep : 1
        emitChange(hour, (minute + 60 - step) % 60)
      }
    },
    [disabled, emitChange, hour, minute, minuteStep]
  )

  const handleHourChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return
      const raw = parseInt(e.target.value, 10)
      if (isNaN(raw)) return
      emitChange(Math.max(0, Math.min(23, raw)), minute)
    },
    [disabled, emitChange, minute]
  )

  const handleMinuteChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return
      const raw = parseInt(e.target.value, 10)
      if (isNaN(raw)) return
      const snapped = minuteStep > 1 ? snapMinute(raw, minuteStep) : Math.max(0, Math.min(59, raw))
      emitChange(hour, snapped)
    },
    [disabled, emitChange, hour, minuteStep]
  )

  const wrapperClass = 'w-14'
  const innerInputClass =
    'text-center tabular-nums leading-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-outer-spin-button]:m-0'

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        type="number"
        min={0}
        max={23}
        value={padTwo(hour)}
        onChange={handleHourChange}
        onKeyDown={handleHourKeyDown}
        disabled={disabled}
        aria-label={hourLabel}
        data-crud-focus-target=""
        className={wrapperClass}
        inputClassName={innerInputClass}
      />
      <span className="text-sm font-medium select-none">:</span>
      <Input
        type="number"
        min={0}
        max={59}
        step={minuteStep}
        value={padTwo(minute)}
        onChange={handleMinuteChange}
        onKeyDown={handleMinuteKeyDown}
        disabled={disabled}
        aria-label={minuteLabel}
        className={wrapperClass}
        inputClassName={innerInputClass}
      />
    </div>
  )
}
