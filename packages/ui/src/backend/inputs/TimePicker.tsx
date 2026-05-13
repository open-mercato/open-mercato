"use client"

import * as React from 'react'
import { ClockIcon } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  TimePicker as TimePickerPrimitive,
  formatTimePickerDisplay,
} from '../../primitives/time-picker'

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

/**
 * Legacy popover-anchored time picker. Preserved for backward compatibility with
 * existing CrudForm `type: 'time'` consumers and DateTimePicker. Internally a shim
 * over the new `<TimePicker>` primitive from `@open-mercato/ui/primitives/time-picker`.
 *
 * `minuteStep` maps to `intervalMinutes` (default 30 for sane slot list size).
 * `showNowButton` / `showClearButton` render as `legacyFooterActions`.
 */
export function TimePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  readOnly = false,
  className,
  minuteStep = 30,
  showNowButton = true,
  // Default changed 2026-05-11 from `true` → `false`: the new primitive's Cancel
  // button already exits the popover without committing, which is what users mean
  // by "Clear" in most flows. Pass `showClearButton={true}` to opt back in when
  // you need an explicit "set value to null" action distinct from "dismiss".
  showClearButton = false,
}: TimePickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const placeholderText = placeholder ?? t('ui.timePicker.placeholder', 'Pick a time')
  const nowText = t('ui.timePicker.nowButton', 'Now')
  const clearText = t('ui.timePicker.clearButton', 'Clear')
  const isInteractive = !disabled && !readOnly

  // Render the trigger label in the same 12h "HH:MM AM/PM" format as the slot list
  // inside the popover so users see one consistent representation.
  const displayValue = value
    ? (() => {
        const { main, suffix } = formatTimePickerDisplay(value, '12h')
        return suffix ? `${main} ${suffix}` : main
      })()
    : null

  const triggerButton = (
    <button
      type="button"
      data-crud-focus-target=""
      disabled={disabled}
      aria-haspopup="dialog"
      className={cn(
        'w-full h-10 flex items-center gap-2 rounded-md border bg-background px-3 text-sm text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed',
        readOnly && 'cursor-default opacity-70',
        !value && 'text-muted-foreground',
        className,
      )}
      onClick={!isInteractive ? (event) => event.preventDefault() : undefined}
    >
      <ClockIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{displayValue ?? placeholderText}</span>
    </button>
  )

  if (!isInteractive) {
    return triggerButton
  }

  const pinnedTopActions: Array<{
    label: string
    onClick: () => void
    icon?: React.ReactNode
    rightText?: string
  }> = []
  if (showNowButton) {
    const nowValue = currentHHMM()
    const { main: nowMain, suffix: nowSuffix } = formatTimePickerDisplay(nowValue, '12h')
    pinnedTopActions.push({
      label: nowText,
      icon: <ClockIcon aria-hidden="true" />,
      rightText: nowSuffix ? `${nowMain} ${nowSuffix}` : nowMain,
      onClick: () => {
        onChange(nowValue)
        setOpen(false)
      },
    })
  }

  const legacyFooterActions: Array<{ label: string; onClick: () => void; variant: 'link' | 'muted' }> = []
  if (showClearButton) {
    legacyFooterActions.push({
      label: clearText,
      onClick: () => {
        onChange(null)
        setOpen(false)
      },
      variant: 'muted',
    })
  }

  return (
    <TimePickerPrimitive
      value={value ?? null}
      onChange={(next) => onChange(next)}
      onApply={(next) => {
        onChange(next)
      }}
      intervalMinutes={Math.max(1, minuteStep)}
      // Trigger button already displays current value — don't duplicate it
      // inside the popover header.
      showHeader={false}
      showFooter
      headerPlaceholder={placeholderText}
      pinnedTopActions={pinnedTopActions.length > 0 ? pinnedTopActions : undefined}
      legacyFooterActions={legacyFooterActions.length > 0 ? legacyFooterActions : undefined}
      trigger={triggerButton}
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
    />
  )
}
