"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DATE_RANGE_OPTIONS, type DateRangePreset } from './dateRanges'

export type DateRangeSelectProps = {
  value: DateRangePreset
  onChange: (value: DateRangePreset) => void
  id?: string
  label?: string
  className?: string
}

export function DateRangeSelect({
  value,
  onChange,
  id = 'date-range-select',
  label,
  className = '',
}: DateRangeSelectProps) {
  const t = useT()

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-semibold uppercase text-muted-foreground"
        >
          {label}
        </label>
      )}
      <select
        id={id}
        className="w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={(e) => onChange(e.target.value as DateRangePreset)}
      >
        {DATE_RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey, option.value.replace(/_/g, ' '))}
          </option>
        ))}
      </select>
    </div>
  )
}

export default DateRangeSelect
