"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DATE_RANGE_OPTIONS, type DateRangePreset } from '../../lib/dateRanges'

export type InlineDateRangeSelectProps = {
  value: DateRangePreset
  onChange: (value: DateRangePreset) => void
  className?: string
}

export function InlineDateRangeSelect({
  value,
  onChange,
  className = '',
}: InlineDateRangeSelectProps) {
  const t = useT()

  const currentOption = DATE_RANGE_OPTIONS.find((opt) => opt.value === value)
  const displayLabel = currentOption
    ? t(currentOption.labelKey, currentOption.value.replace(/_/g, ' '))
    : value.replace(/_/g, ' ')

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <select
        className="appearance-none rounded-md border border-border bg-background px-2 py-0.5 pr-6 text-xs text-foreground hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value as DateRangePreset)}
        title={displayLabel}
      >
        {DATE_RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey, option.value.replace(/_/g, ' '))}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-muted-foreground"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}

export default InlineDateRangeSelect
